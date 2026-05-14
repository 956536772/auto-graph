package com.autograph.backend.chat;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

@Service
public class GeometryChatService {

    static final Set<String> POINT_TYPES = Set.of("point", "glider");
    static final Set<String> LINE_TYPES = Set.of("segment", "line", "parallel", "perpendicular", "tangent");
    static final Set<String> CIRCLE_TYPES = Set.of("circle", "circumcircle", "incircle");

    private static final Pattern UPPERCASE_LABEL = Pattern.compile("[A-Z]");
    private final GeometryLlmClient llmClient;

    public GeometryChatService() {
        this(GeometryLlmClient.disabled());
    }

    public GeometryChatService(GeometryLlmClient llmClient) {
        this.llmClient = llmClient;
    }

    public ChatResponse handle(ChatRequest request) {
        var context = ContextIndex.from(request.context());
        var extraction = extractIntent(normalize(request.text()), context);
        if (extraction.clarification() != null) {
            return ChatResponse.clarification(extraction.clarification());
        }
        if (extraction.intent() == null) {
            return ChatResponse.error("目前支持三角形、正方形、连接线段、中点、平行/垂线、圆、外接圆、内切圆、过圆上一点作切线、两圆交点这些指令。");
        }

        var resolved = resolveIntent(extraction.intent(), context);
        if (resolved.clarification() != null) {
            return ChatResponse.clarification(resolved.clarification());
        }
        if (resolved.errorMessage() != null) {
            return ChatResponse.error(resolved.errorMessage());
        }

        var instructions = compile(resolved.intent(), context);
        if (instructions.isEmpty()) {
            return ChatResponse.error("这次没有生成可执行的绘图指令。");
        }
        return ChatResponse.ok(instructions, resolved.intent().successMessage());
    }

    private IntentExtraction extractIntent(String text, ContextIndex context) {
        var llmIntent = llmClient.extractIntent(text, context);
        if (llmIntent.isPresent()) {
            return new IntentExtraction(llmIntent.get(), null);
        }

        if (text.isBlank()) {
            return new IntentExtraction(null, null);
        }
        if (text.contains("正方形")) {
            return new IntentExtraction(new GeometryIntent(IntentType.CREATE_SQUARE, Map.of("labels", labelsOrDefaults(text, 4, List.of("A", "B", "C", "D"))), "为你画好了正方形。"), null);
        }
        if (text.contains("三角形") && !text.contains("外接圆") && !text.contains("内切圆")) {
            return new IntentExtraction(new GeometryIntent(IntentType.CREATE_TRIANGLE, Map.of("labels", labelsOrDefaults(text, 3, List.of("A", "B", "C"))), "为你画好了三角形。"), null);
        }
        if (text.contains("外接圆")) {
            return new IntentExtraction(createThreePointIntent(IntentType.CREATE_CIRCUMCIRCLE, text, context, "已根据三点作出外接圆。"), null);
        }
        if (text.contains("内切圆")) {
            return new IntentExtraction(createThreePointIntent(IntentType.CREATE_INCIRCLE, text, context, "已根据三角形作出内切圆。"), null);
        }
        if (text.contains("交点") && text.contains("圆")) {
            return new IntentExtraction(extractCircleIntersectionsIntent(text), null);
        }
        if (text.contains("切线")) {
            return new IntentExtraction(extractTangentIntent(text), null);
        }
        if (text.contains("中点")) {
            return new IntentExtraction(extractMidpointIntent(text), null);
        }
        if (text.contains("平行线")) {
            return new IntentExtraction(extractLineRelationIntent(text, IntentType.CREATE_PARALLEL), null);
        }
        if (text.contains("垂线")) {
            return new IntentExtraction(extractLineRelationIntent(text, IntentType.CREATE_PERPENDICULAR), null);
        }
        if (text.contains("圆心") && text.contains("过")) {
            return new IntentExtraction(extractCircleIntent(text), null);
        }
        if (text.contains("连接") || text.contains("线段")) {
            return new IntentExtraction(extractSegmentIntent(text), null);
        }
        return new IntentExtraction(null, null);
    }

    private GeometryIntent createThreePointIntent(IntentType type, String text, ContextIndex context, String successMessage) {
        var labels = extractLabels(text);
        if (labels.size() >= 3) {
            return new GeometryIntent(type, Map.of(
                "p1", RefQuery.label(labels.get(0), POINT_TYPES),
                "p2", RefQuery.label(labels.get(1), POINT_TYPES),
                "p3", RefQuery.label(labels.get(2), POINT_TYPES)
            ), successMessage);
        }
        if (text.contains("这个三角形") || text.contains("当前三角形")) {
            var latest = context.latestPoints(3);
            if (latest.size() == 3) {
                return new GeometryIntent(type, Map.of(
                    "p1", RefQuery.label(latest.get(0).label(), POINT_TYPES),
                    "p2", RefQuery.label(latest.get(1).label(), POINT_TYPES),
                    "p3", RefQuery.label(latest.get(2).label(), POINT_TYPES)
                ), successMessage);
            }
        }
        return new GeometryIntent(type, Map.of(), "请先给出三个点。");
    }

    private GeometryIntent extractSegmentIntent(String text) {
        var labels = extractLabels(text);
        if (labels.size() >= 2) {
            return new GeometryIntent(IntentType.CREATE_SEGMENT, Map.of(
                "from", RefQuery.label(labels.get(0), POINT_TYPES),
                "to", RefQuery.label(labels.get(1), POINT_TYPES)
            ), "已连接这两个点。");
        }
        var stripped = cleanReference(text.replace("连接", "").replace("线段", ""));
        var split = splitOnJoiners(stripped);
        if (split != null) {
            return new GeometryIntent(IntentType.CREATE_SEGMENT, Map.of(
                "from", parsePointReference(split.left()),
                "to", parsePointReference(split.right())
            ), "已连接这两个点。");
        }
        return null;
    }

    private GeometryIntent extractMidpointIntent(String text) {
        var pair = contiguousPair(text);
        if (pair != null) {
            return new GeometryIntent(IntentType.CREATE_MIDPOINT, Map.of(
                "a", RefQuery.label(pair.substring(0, 1), POINT_TYPES),
                "b", RefQuery.label(pair.substring(1, 2), POINT_TYPES)
            ), "已作出中点。");
        }
        var labels = extractLabels(text);
        if (labels.size() >= 2) {
            return new GeometryIntent(IntentType.CREATE_MIDPOINT, Map.of(
                "a", RefQuery.label(labels.get(0), POINT_TYPES),
                "b", RefQuery.label(labels.get(1), POINT_TYPES)
            ), "已作出中点。");
        }
        return null;
    }

    private GeometryIntent extractLineRelationIntent(String text, IntentType type) {
        var matcher = Pattern.compile("过(.+?)作(.+?)(?:的)?(?:平行线|垂线)").matcher(text);
        if (matcher.find()) {
            return new GeometryIntent(type, Map.of(
                "point", parsePointReference(matcher.group(1)),
                "line", parseLineReference(matcher.group(2))
            ), type == IntentType.CREATE_PARALLEL ? "已作出平行线。" : "已作出垂线。");
        }
        return null;
    }

    private GeometryIntent extractCircleIntent(String text) {
        var matcher = Pattern.compile("以(.+?)为圆心.*过(.+?)").matcher(text);
        if (matcher.find()) {
            return new GeometryIntent(IntentType.CREATE_CIRCLE, Map.of(
                "center", parsePointReference(matcher.group(1)),
                "through", parsePointReference(matcher.group(2))
            ), "已作出这个圆。");
        }
        return null;
    }

    private GeometryIntent extractTangentIntent(String text) {
        var matcher = Pattern.compile("过(.+?)作(.+?)(?:的)?切线").matcher(text);
        if (matcher.find()) {
            return new GeometryIntent(IntentType.CREATE_TANGENT, Map.of(
                "point", parsePointReference(matcher.group(1)),
                "circle", parseCircleReference(matcher.group(2))
            ), "已作出这条切线。");
        }
        return null;
    }

    private GeometryIntent extractCircleIntersectionsIntent(String text) {
        var matcher = Pattern.compile("(.+?)(?:和|与|跟)(.+?)的交点").matcher(text);
        if (matcher.find()) {
            return new GeometryIntent(IntentType.CREATE_CIRCLE_INTERSECTIONS, Map.of(
                "first", parseCircleReference(matcher.group(1)),
                "second", parseCircleReference(matcher.group(2))
            ), "已求出这两个圆的交点。");
        }
        return null;
    }

    private ResolutionOutcome resolveIntent(GeometryIntent intent, ContextIndex context) {
        return switch (intent.type()) {
            case CREATE_TRIANGLE, CREATE_SQUARE -> new ResolutionOutcome(intent, null, null);
            case CREATE_SEGMENT -> resolvePair(intent, context, "from", "to");
            case CREATE_MIDPOINT -> resolvePair(intent, context, "a", "b");
            case CREATE_PARALLEL, CREATE_PERPENDICULAR -> resolveLineRelation(intent, context);
            case CREATE_CIRCLE -> resolvePair(intent, context, "center", "through");
            case CREATE_CIRCUMCIRCLE, CREATE_INCIRCLE -> resolveTriple(intent, context);
            case CREATE_TANGENT -> resolveTangent(intent, context);
            case CREATE_CIRCLE_INTERSECTIONS -> resolveCirclePair(intent, context);
        };
    }

    private ResolutionOutcome resolvePair(GeometryIntent intent, ContextIndex context, String leftKey, String rightKey) {
        var left = resolveReference((RefQuery) intent.args().get(leftKey), context);
        if (left.clarification() != null || left.errorMessage() != null) {
            return left.toOutcome();
        }
        var right = resolveReference((RefQuery) intent.args().get(rightKey), context);
        if (right.clarification() != null || right.errorMessage() != null) {
            return right.toOutcome();
        }
        return new ResolutionOutcome(intent.withResolvedArgs(Map.of(leftKey, left.object().id(), rightKey, right.object().id())), null, null);
    }

    private ResolutionOutcome resolveTriple(GeometryIntent intent, ContextIndex context) {
        var p1 = resolveReference((RefQuery) intent.args().get("p1"), context);
        if (p1.clarification() != null || p1.errorMessage() != null) {
            return p1.toOutcome();
        }
        var p2 = resolveReference((RefQuery) intent.args().get("p2"), context);
        if (p2.clarification() != null || p2.errorMessage() != null) {
            return p2.toOutcome();
        }
        var p3 = resolveReference((RefQuery) intent.args().get("p3"), context);
        if (p3.clarification() != null || p3.errorMessage() != null) {
            return p3.toOutcome();
        }
        return new ResolutionOutcome(intent.withResolvedArgs(Map.of(
            "p1", p1.object().id(),
            "p2", p2.object().id(),
            "p3", p3.object().id()
        )), null, null);
    }

    private ResolutionOutcome resolveLineRelation(GeometryIntent intent, ContextIndex context) {
        var point = resolveReference((RefQuery) intent.args().get("point"), context);
        if (point.clarification() != null || point.errorMessage() != null) {
            return point.toOutcome();
        }
        var line = resolveReference((RefQuery) intent.args().get("line"), context);
        if (line.clarification() != null || line.errorMessage() != null) {
            return line.toOutcome();
        }
        return new ResolutionOutcome(intent.withResolvedArgs(Map.of("point", point.object().id(), "line", line.object().id())), null, null);
    }

    private ResolutionOutcome resolveTangent(GeometryIntent intent, ContextIndex context) {
        var point = resolveReference((RefQuery) intent.args().get("point"), context);
        if (point.clarification() != null || point.errorMessage() != null) {
            return point.toOutcome();
        }
        var circle = resolveReference((RefQuery) intent.args().get("circle"), context);
        if (circle.clarification() != null || circle.errorMessage() != null) {
            return circle.toOutcome();
        }
        if (!pointOnCircle(point.object(), circle.object())) {
            return new ResolutionOutcome(null, "目前只支持过圆上一点作切线，请先选中圆上的点。", null);
        }
        return new ResolutionOutcome(intent.withResolvedArgs(Map.of("point", point.object().id(), "circle", circle.object().id())), null, null);
    }

    private ResolutionOutcome resolveCirclePair(GeometryIntent intent, ContextIndex context) {
        var first = resolveReference((RefQuery) intent.args().get("first"), context);
        if (first.clarification() != null || first.errorMessage() != null) {
            return first.toOutcome();
        }
        var second = resolveReference((RefQuery) intent.args().get("second"), context);
        if (second.clarification() != null || second.errorMessage() != null) {
            return second.toOutcome();
        }
        if (Objects.equals(first.object().id(), second.object().id())) {
            return new ResolutionOutcome(null, "需要两个不同的圆才能求交点。", null);
        }
        return new ResolutionOutcome(intent.withResolvedArgs(Map.of("first", first.object().id(), "second", second.object().id())), null, null);
    }

    private ResolvedReference resolveReference(RefQuery query, ContextIndex context) {
        if (query == null) {
            return ResolvedReference.error("缺少必要的对象引用。");
        }
        if (query.explicitLabel() != null) {
            return context.findByLabel(query.explicitLabel(), query.allowedTypes())
                .map(ResolvedReference::ok)
                .orElseGet(() -> ResolvedReference.error("没有找到标签为 " + query.explicitLabel() + " 的对象。"));
        }
        if (query.endpointLabels() != null) {
            return context.findLineByEndpoints(query.endpointLabels().first(), query.endpointLabels().second())
                .map(ResolvedReference::ok)
                .orElseGet(() -> ResolvedReference.error("没有找到对应的线。"));
        }
        if (query.centerLabel() != null) {
            var byCenter = context.findCircleByCenterLabel(query.centerLabel());
            if (byCenter.isPresent()) {
                return ResolvedReference.ok(byCenter.get());
            }
        }

        var candidates = context.findByTypes(query.allowedTypes());
        if (candidates.isEmpty()) {
            return ResolvedReference.error("当前画布里没有可用的相关对象。");
        }

        if (query.descriptor().recent()) {
            return ResolvedReference.ok(candidates.get(candidates.size() - 1));
        }
        if (query.descriptor().sizeHint() != SizeHint.NONE) {
            return bySize(query, candidates);
        }
        if (query.descriptor().positionHint() != PositionHint.NONE) {
            return byPosition(query, candidates);
        }
        if (candidates.size() == 1) {
            return ResolvedReference.ok(candidates.get(0));
        }
        return ResolvedReference.clarify(Clarification.fromCandidates("我不确定你指的是哪一个对象，请明确说出标签或位置。", candidates));
    }

    private ResolvedReference bySize(RefQuery query, List<CanvasObject> candidates) {
        var sized = candidates.stream()
            .filter(obj -> obj.radius() != null)
            .sorted(Comparator.comparingDouble(obj -> obj.radius() == null ? 0d : obj.radius()))
            .toList();
        if (sized.isEmpty()) {
            return ResolvedReference.error("当前没有可按大小区分的对象。");
        }
        var first = query.descriptor().sizeHint() == SizeHint.LARGEST ? sized.get(sized.size() - 1) : sized.get(0);
        if (sized.size() > 1) {
            var second = query.descriptor().sizeHint() == SizeHint.LARGEST ? sized.get(sized.size() - 2) : sized.get(1);
            if (Math.abs(first.radius() - second.radius()) < 0.5) {
                return ResolvedReference.clarify(Clarification.fromCandidates("你提到的是大圆/小圆，但当前有多个圆大小很接近，请明确一下。", sized));
            }
        }
        return ResolvedReference.ok(first);
    }

    private ResolvedReference byPosition(RefQuery query, List<CanvasObject> candidates) {
        var positioned = candidates.stream().filter(obj -> obj.anchor() != null).toList();
        if (positioned.isEmpty()) {
            return ResolvedReference.error("当前没有可按位置区分的对象。");
        }
        Comparator<CanvasObject> comparator = switch (query.descriptor().positionHint()) {
            case LEFTMOST -> Comparator.comparingDouble(obj -> obj.anchor().x());
            case RIGHTMOST -> Comparator.comparingDouble((CanvasObject obj) -> obj.anchor().x()).reversed();
            case TOPMOST -> Comparator.comparingDouble((CanvasObject obj) -> obj.anchor().y()).reversed();
            case BOTTOMMOST -> Comparator.comparingDouble(obj -> obj.anchor().y());
            case NONE -> Comparator.comparingInt(CanvasObject::order).reversed();
        };
        var sorted = positioned.stream().sorted(comparator).toList();
        var first = sorted.get(0);
        if (sorted.size() > 1) {
            var second = sorted.get(1);
            var gap = switch (query.descriptor().positionHint()) {
                case LEFTMOST, RIGHTMOST -> Math.abs(first.anchor().x() - second.anchor().x());
                case TOPMOST, BOTTOMMOST -> Math.abs(first.anchor().y() - second.anchor().y());
                case NONE -> 99d;
            };
            if (gap < 1.0) {
                return ResolvedReference.clarify(Clarification.fromCandidates("这个位置描述有些模糊，我不确定你指的是哪一个。", sorted));
            }
        }
        return ResolvedReference.ok(first);
    }

    private List<DrawingInstruction> compile(GeometryIntent intent, ContextIndex context) {
        return switch (intent.type()) {
            case CREATE_TRIANGLE -> compilePolygon((List<String>) intent.args().get("labels"), List.of(
                new Anchor(-3.0, -1.5), new Anchor(0.0, 3.0), new Anchor(3.0, -1.5)
            ), "triangle");
            case CREATE_SQUARE -> compilePolygon((List<String>) intent.args().get("labels"), List.of(
                new Anchor(-2.5, 2.5), new Anchor(2.5, 2.5), new Anchor(2.5, -2.5), new Anchor(-2.5, -2.5)
            ), "square");
            case CREATE_SEGMENT -> List.of(new DrawingInstruction("segment", Map.of("p1", intent.stringArg("from"), "p2", intent.stringArg("to")), generatedId("segment"), null));
            case CREATE_MIDPOINT -> List.of(new DrawingInstruction("midpoint", Map.of("p1", intent.stringArg("a"), "p2", intent.stringArg("b")), generatedId("midpoint"), context.nextAvailableLabel("M")));
            case CREATE_PARALLEL -> List.of(new DrawingInstruction("parallel", Map.of("line", intent.stringArg("line"), "point", intent.stringArg("point")), generatedId("parallel"), null));
            case CREATE_PERPENDICULAR -> List.of(new DrawingInstruction("perpendicular", Map.of("line", intent.stringArg("line"), "point", intent.stringArg("point")), generatedId("perpendicular"), null));
            case CREATE_CIRCLE -> List.of(new DrawingInstruction("circle", Map.of("center", intent.stringArg("center"), "through", intent.stringArg("through")), generatedId("circle"), null));
            case CREATE_CIRCUMCIRCLE -> List.of(new DrawingInstruction("circumcircle", Map.of("p1", intent.stringArg("p1"), "p2", intent.stringArg("p2"), "p3", intent.stringArg("p3")), generatedId("circumcircle"), null));
            case CREATE_INCIRCLE -> List.of(new DrawingInstruction("incircle", Map.of("p1", intent.stringArg("p1"), "p2", intent.stringArg("p2"), "p3", intent.stringArg("p3")), generatedId("incircle"), null));
            case CREATE_TANGENT -> List.of(new DrawingInstruction("tangent", Map.of("circle", intent.stringArg("circle"), "point", intent.stringArg("point")), generatedId("tangent"), null));
            case CREATE_CIRCLE_INTERSECTIONS -> compileIntersections(intent, context);
        };
    }

    private List<DrawingInstruction> compilePolygon(List<String> labels, List<Anchor> anchors, String prefix) {
        var instructions = new ArrayList<DrawingInstruction>();
        for (int i = 0; i < labels.size(); i++) {
            instructions.add(new DrawingInstruction("place_point", Map.of("x", anchors.get(i).x(), "y", anchors.get(i).y()), labels.get(i), labels.get(i)));
        }
        instructions.add(new DrawingInstruction("polygon", Map.of("points", labels), generatedId(prefix), null));
        return instructions;
    }

    private List<DrawingInstruction> compileIntersections(GeometryIntent intent, ContextIndex context) {
        var firstId = generatedId("intersection");
        return List.of(
            new DrawingInstruction("intersection", Map.of("first", intent.stringArg("first"), "second", intent.stringArg("second"), "index", 0), firstId, context.nextAvailableLabel("I1")),
            new DrawingInstruction("otherintersection", Map.of("first", intent.stringArg("first"), "second", intent.stringArg("second"), "known", firstId), generatedId("intersection"), context.nextAvailableLabel("I2"))
        );
    }

    private boolean pointOnCircle(CanvasObject point, CanvasObject circle) {
        if (point.anchor() == null || circle.center() == null || circle.radius() == null) {
            return false;
        }
        var dx = point.anchor().x() - circle.center().x();
        var dy = point.anchor().y() - circle.center().y();
        return Math.abs(Math.sqrt(dx * dx + dy * dy) - circle.radius()) < 0.75;
    }

    private RefQuery parsePointReference(String raw) {
        return parseReference(raw, POINT_TYPES);
    }

    private RefQuery parseCircleReference(String raw) {
        var normalized = cleanReference(raw);
        var centerMatcher = Pattern.compile("([A-Z])(?:为圆心|圆心)").matcher(normalized);
        if (centerMatcher.find()) {
            return RefQuery.circleByCenter(centerMatcher.group(1), CIRCLE_TYPES);
        }
        return parseReference(normalized, CIRCLE_TYPES);
    }

    private RefQuery parseLineReference(String raw) {
        var normalized = cleanReference(raw);
        var pair = contiguousPair(normalized);
        if (pair != null) {
            return RefQuery.lineByEndpoints(pair.substring(0, 1), pair.substring(1, 2), LINE_TYPES);
        }
        return parseReference(normalized, LINE_TYPES);
    }

    private RefQuery parseReference(String raw, Set<String> allowedTypes) {
        var normalized = cleanReference(raw);
        var labels = extractLabels(normalized);
        if (labels.size() == 1) {
            return RefQuery.label(labels.get(0), allowedTypes);
        }
        return new RefQuery(normalized, allowedTypes, null, null, null, descriptorFrom(normalized));
    }

    private Descriptor descriptorFrom(String text) {
        var normalized = cleanReference(text);
        var recent = normalized.contains("刚才") || normalized.contains("最近") || normalized.contains("上一个") || normalized.contains("这个");
        var sizeHint = normalized.contains("大") ? SizeHint.LARGEST : normalized.contains("小") ? SizeHint.SMALLEST : SizeHint.NONE;
        var positionHint = PositionHint.NONE;
        if (normalized.contains("左")) {
            positionHint = PositionHint.LEFTMOST;
        } else if (normalized.contains("右")) {
            positionHint = PositionHint.RIGHTMOST;
        } else if (normalized.contains("上")) {
            positionHint = PositionHint.TOPMOST;
        } else if (normalized.contains("下")) {
            positionHint = PositionHint.BOTTOMMOST;
        }
        return new Descriptor(positionHint, sizeHint, recent);
    }

    private List<String> labelsOrDefaults(String text, int expected, List<String> defaults) {
        var labels = extractLabels(text);
        return labels.size() >= expected ? labels.subList(0, expected) : defaults;
    }

    private List<String> extractLabels(String text) {
        var labels = new ArrayList<String>();
        var matcher = UPPERCASE_LABEL.matcher(text);
        while (matcher.find()) {
            labels.add(matcher.group());
        }
        return labels.stream().distinct().toList();
    }

    private Pair splitOnJoiners(String raw) {
        for (var joiner : List.of("和", "与", "跟", "及")) {
            var index = raw.indexOf(joiner);
            if (index > 0 && index < raw.length() - joiner.length()) {
                return new Pair(raw.substring(0, index), raw.substring(index + joiner.length()));
            }
        }
        return null;
    }

    private String contiguousPair(String text) {
        var matcher = Pattern.compile("([A-Z]{2})").matcher(text);
        return matcher.find() ? matcher.group(1) : null;
    }

    private String cleanReference(String raw) {
        return raw
            .replace("点", "")
            .replace("线段", "")
            .replace("直线", "")
            .replace("圆", "")
            .replace("那个", "")
            .replace("条", "")
            .replace(" ", "")
            .trim();
    }

    private String normalize(String text) {
        return text == null ? "" : text.replace('，', ',').replace('。', ' ').trim().toUpperCase(Locale.ROOT);
    }

    private String generatedId(String prefix) {
        return prefix + "_" + System.nanoTime();
    }
}

record Pair(String left, String right) {
}
