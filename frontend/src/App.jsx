import { useEffect, useRef, useState } from 'react';
import JXG from 'jsxgraph';
import { ShapeRegistry } from './lib/ShapeRegistry';
import { DrawingEngine } from './lib/DrawingEngine';
import { ManualDrawingController } from './lib/manualTools/ManualDrawingController.js';
import { TOOLS } from './lib/manualTools/constants.js';
import { ensurePointLabelEditor, getNextPointLabel } from './lib/manualTools/labels.js';
import { exportBoardPreviewSvg, svgToObjectUrl } from './lib/previewExport.js';
import { buildChatRequestPayload, INITIAL_AI_MESSAGE } from './lib/chatPayload.js';
import './App.css';

const INITIAL_BOUNDING_BOX = [-10, 10, 10, -10];

const IconPreview = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
    <circle cx="12" cy="13" r="4"></circle>
  </svg>
);

const IconSelect = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path><path d="M13 13l6 6"></path></svg>;
const IconPoint = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle></svg>;
const IconSegment = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><circle cx="5" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></svg>;
const IconCircle = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"></circle></svg>;
const IconUndo = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"></path></svg>;
const IconRedo = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6"></path><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3L21 13"></path></svg>;
const IconClear = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>;
const ToolGlyph = ({ text }) => <span className="tool-glyph">{text}</span>;

const TOOL_GROUPS = [
  {
    name: '基础',
    tools: [
    { tool: TOOLS.SELECT, title: '选择', icon: <IconSelect /> },
    { tool: TOOLS.POINT, title: '点', icon: <IconPoint /> },
    { tool: TOOLS.SEGMENT, title: '线段', icon: <IconSegment /> },
    { tool: TOOLS.CIRCLE, title: '圆', icon: <IconCircle /> },
    { tool: TOOLS.RECTANGLE, title: '矩形/正方形', icon: <ToolGlyph text="▭" /> },
    { tool: TOOLS.TRIANGLE, title: '等腰/等边三角形', icon: <ToolGlyph text="△" /> }
    ]
  },
  {
    name: '构造',
    tools: [
    { tool: TOOLS.LABEL, title: '点标签', icon: <ToolGlyph text="A" /> },
    { tool: TOOLS.ANGLE, title: '角标记', icon: <ToolGlyph text="∠" /> },
    { tool: TOOLS.MIDPOINT, title: '中点', icon: <ToolGlyph text="M" /> },
    { tool: TOOLS.PARALLEL, title: '平行', icon: <ToolGlyph text="∥" /> },
    { tool: TOOLS.PERPENDICULAR, title: '垂直', icon: <ToolGlyph text="⊥" /> },
    { tool: TOOLS.ANGLE_BISECTOR, title: '角平分线', icon: <ToolGlyph text="∠/" /> }
    ]
  },
  {
    name: '历史',
    tools: [
    { tool: TOOLS.UNDO, title: '撤销', icon: <IconUndo /> },
    { tool: TOOLS.REDO, title: '重做', icon: <IconRedo /> },
    { tool: TOOLS.CLEAR, title: '清空', icon: <IconClear /> }
    ]
  }
];

const TOOL_GUIDES = {
  [TOOLS.SELECT]: '选择对象；右键对象打开删除菜单，拖动画布可平移。',
  [TOOLS.POINT]: '点击空白处创建点；贴近已有线或圆时会自动吸附。',
  [TOOLS.SEGMENT]: '依次点击点创建连续线段；回到起点可封闭成图形，Esc 结束。',
  [TOOLS.CIRCLE]: '按住拖拽确定圆心和半径。',
  [TOOLS.RECTANGLE]: '拖拽创建矩形；按住 Shift 约束为正方形。',
  [TOOLS.TRIANGLE]: '拖拽创建等腰三角形；按住 Shift 约束为等边三角形。',
  [TOOLS.LABEL]: '点击点编辑标签。',
  [TOOLS.ANGLE]: '依次选择边点、顶点、边点，生成角标记。',
  [TOOLS.MIDPOINT]: '选择两个点，自动创建中点。',
  [TOOLS.PARALLEL]: '先选参考线段，再选过线点。',
  [TOOLS.PERPENDICULAR]: '先选参考线段，再选过线点。',
  [TOOLS.ANGLE_BISECTOR]: '依次选择边点、顶点、边点，生成角平分线。'
};

const PROMPT_SUGGESTIONS = [
  '画一个三角形 ABC，并作它的外接圆',
  '画出 y = x^2 的图像',
  '过圆上一点作切线'
];

const initialMessages = () => [{ ...INITIAL_AI_MESSAGE }];

const PreviewModal = ({ data, board, onClose }) => {
  const [svgUrl, setSvgUrl] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    if (!data || !board) return;

    let cancelled = false;
    let objectUrl = null;

    const generatePreview = () => {
      try {
        const examSvg = exportBoardPreviewSvg({ board, selection: data });
        objectUrl = svgToObjectUrl(examSvg);
        if (!cancelled) {
          setSvgUrl(objectUrl);
          setErrorMessage(null);
        }
      } catch (err) {
        console.error('Preview failed:', err);
        if (!cancelled) {
          setErrorMessage(`生成预览失败：${err.message}`);
        }
      }
    };

    generatePreview();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [data, board, onClose]);

  const downloadFile = (type) => {
    if (!svgUrl) return;
    const link = document.createElement('a');
    if (type === 'svg') {
      link.href = svgUrl;
      link.download = `geometry_export_${Date.now()}.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const scale = 2; // High resolution
          canvas.width = (img.naturalWidth || img.width) * scale;
          canvas.height = (img.naturalHeight || img.height) * scale;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          link.href = canvas.toDataURL('image/png');
          link.download = `geometry_export_${Date.now()}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } catch (err) {
          console.error('PNG export failed:', err);
          alert('导出 PNG 失败，请尝试导出 SVG');
        }
      };
      img.onerror = (e) => {
        console.error('Image load error:', e);
        alert('解析预览图失败，无法导出 PNG');
      };
      img.src = svgUrl;
    }
  };

  const copyToClipboard = () => {
    if (!svgUrl) return;
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (!blob) {
            alert('生成图片数据失败');
            return;
          }
          if (typeof ClipboardItem !== 'undefined') {
            try {
              const data = [new ClipboardItem({ [blob.type]: blob })];
              navigator.clipboard.write(data).then(() => {
                alert('图片已复制到剪贴板');
              }).catch(err => {
                console.error('Clipboard write failed:', err);
                alert('由于浏览器安全限制，无法直接复制图片，请使用导出 PNG 功能');
              });
            } catch (err) {
              console.error('Clipboard write failed:', err);
              alert('由于浏览器安全限制，无法直接复制图片，请使用导出 PNG 功能');
            }
          } else {
            alert('您的浏览器不支持直接复制图片，请使用导出 PNG 功能');
          }
        }, 'image/png');
      } catch (err) {
        console.error('Clipboard copy failed:', err);
        alert('复制失败，请尝试导出 PNG');
      }
    };
    img.onerror = () => {
      alert('解析预览图失败，无法复制');
    };
    img.src = svgUrl;
  };

  if (!svgUrl) return null;

  return (
    <div className="preview-modal-overlay">
      <div className="preview-modal floating-panel">
        <div className="preview-header">
          <span>预览</span>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="preview-content">
          {svgUrl && <img src={svgUrl} alt="Preview" />}
          {!svgUrl && !errorMessage && <div className="preview-state">正在生成预览...</div>}
          {errorMessage && <div className="preview-state error">{errorMessage}</div>}
        </div>
        <div className="preview-footer">
          <button onClick={() => downloadFile('png')} disabled={!svgUrl}>导出 PNG</button>
          <button onClick={() => downloadFile('svg')} disabled={!svgUrl}>导出 SVG</button>
          <button className="primary" onClick={copyToClipboard} disabled={!svgUrl}>复制到剪贴板</button>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const boardRef = useRef(null);
  const registryRef = useRef(new ShapeRegistry());
  const engineRef = useRef(null);
  const controllerRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const [activeTool, setActiveTool] = useState(TOOLS.SELECT);
  const [status, setStatus] = useState('就绪 - 请在右侧输入绘图需求');
  const [messages, setMessages] = useState(initialMessages);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [board, setBoard] = useState(null);

  useEffect(() => {
    const boardInstance = JXG.JSXGraph.initBoard(boardRef.current, {
      boundingbox: INITIAL_BOUNDING_BOX,
      axis: false,
      grid: true,
      showCopyright: false,
      keepaspectratio: true,
      shownavigation: true,
      browserContext: 'ignore',
      ignoreLabels: false,
      pan: { enabled: true, needTwoFingers: false, needShift: false },
      zoom: { wheel: true, needShift: false }
    });
    setBoard(boardInstance);

    const decorateObject = (obj) => {
      if (obj.elType !== 'point' && obj.elType !== 'glider') {
        return;
      }
      ensurePointLabelEditor(obj, {
        board: boardInstance,
        suggestLabel: () => getNextPointLabel(registryRef.current),
        onBeforeLabelEdit: () => registryRef.current.snapshot(),
        onLabelEdit: ({ beforeState }) => {
          registryRef.current.commitSnapshotAction('label', beforeState, registryRef.current.snapshot(), { label: 'label' });
        }
      });
    };

    engineRef.current = new DrawingEngine(boardInstance, registryRef.current, {
      onObjectCreated: decorateObject
    });
    controllerRef.current = new ManualDrawingController({
      board: boardInstance,
      engine: engineRef.current,
      registry: registryRef.current,
      onStatusChange: setStatus,
      onToolChange: setActiveTool,
      onPreviewSelect: setPreviewData
    });

    const handleResize = () => {
      boardInstance.resizeContainer(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      controllerRef.current?.destroy();
      controllerRef.current = null;
      JXG.JSXGraph.freeBoard(boardInstance);
      setBoard(null);
    };
  }, []);

  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const board = engineRef.current?.board;
    if (!board) {
      return;
    }

    const isSelectTool = activeTool === TOOLS.SELECT;
    board.setAttribute({
      browsing: { enabled: isSelectTool },
      pan: { enabled: isSelectTool }
    });
    controllerRef.current?.setActiveTool(activeTool);
  }, [activeTool]);

  const handleToolClick = (tool) => {
    if (tool === TOOLS.CLEAR) {
      if (window.confirm('确定要清空当前画布并重置对话吗？')) {
        const board = engineRef.current?.board;
        registryRef.current.removeCurrentObjects(board);
        registryRef.current.clear();
        controllerRef.current?.resetState({ discardPendingGroups: true });
        setMessages(initialMessages());
        setInputText('');
        setPreviewData(null);
        setActiveTool(TOOLS.SELECT);
        board?.setBoundingBox(INITIAL_BOUNDING_BOX, true);
        board?.update();
        setStatus('已清空画布并重置对话');
      }
      return;
    }

    if (tool === TOOLS.UNDO) {
      const board = engineRef.current?.board;
      const removedId = board ? registryRef.current.undo(board) : null;
      controllerRef.current?.resetState();
      setStatus(removedId ? '已撤销上一步操作' : '没有可撤销的操作');
      return;
    }

    if (tool === TOOLS.REDO) {
      const board = engineRef.current?.board;
      const restoredId = board ? registryRef.current.redo(board) : null;
      controllerRef.current?.resetState();
      setStatus(restoredId ? '已重做上一步操作' : '没有可重做的操作');
      return;
    }

    setActiveTool(tool);
  };

  const adjustZoom = (scale) => {
    const board = engineRef.current?.board;
    if (!board) {
      return;
    }
    const [left, top, right, bottom] = board.getBoundingBox();
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    const halfWidth = ((right - left) * scale) / 2;
    const halfHeight = ((top - bottom) * scale) / 2;
    board.setBoundingBox([centerX - halfWidth, centerY + halfHeight, centerX + halfWidth, centerY - halfHeight], true);
    board.update();
  };

  const resetView = () => {
    const board = engineRef.current?.board;
    if (!board) {
      return;
    }
    board.setBoundingBox(INITIAL_BOUNDING_BOX, true);
    board.update();
    setStatus('视图已复位');
  };

  const handleSendMessage = async () => {
    const text = inputText.trim();
    if (!text || isSending) {
      return;
    }

    setIsSending(true);
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setInputText('');
    setStatus('AI 正在分析题意并绘图...');

    try {
      const response = await fetch('http://localhost:8080/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildChatRequestPayload({
          text,
          registry: registryRef.current
        }))
      });
      const data = await response.json();

      if (data.instructions && data.instructions.length > 0) {
        engineRef.current.execute(data.instructions);
      }

      let aiText = data.responseText;
      if (!aiText) {
        if (data.status === 'instructions') {
          aiText = '已根据你的描述执行了绘图操作。';
        } else if (data.status === 'clarification') {
          aiText = data.clarification?.question || '我需要你进一步明确绘图意图。';
        } else if (data.status === 'error') {
          aiText = '抱歉，绘图请求处理失败，请尝试调整描述。';
        } else {
          aiText = '抱歉，我暂时无法处理这个请求。';
        }
      }
      setMessages((prev) => [...prev, { role: 'ai', text: aiText }]);
      if (data.status === 'clarification') {
        setStatus('需要澄清 - 请补充说明后再发送');
      } else if (data.status === 'error') {
        setStatus('未执行 - 请调整描述');
      } else {
        setStatus('就绪');
      }
    } catch (error) {
      console.error(error);
      setMessages((prev) => [...prev, { role: 'ai', text: '抱歉，无法连接到后端服务。' }]);
      setStatus('错误');
    } finally {
      setIsSending(false);
    }
  };

  const canSend = inputText.trim().length > 0 && !isSending;
  const activeGuide = TOOL_GUIDES[activeTool] || '选择一个工具开始操作。';
  const statusTone = status.includes('错误') || status.includes('未执行')
    ? 'danger'
    : status.includes('需要') || status.includes('取消') || status.includes('过小')
      ? 'warning'
      : 'ready';

  return (
    <>
      <div
        ref={boardRef}
        className="jxgbox"
        style={{ width: '100vw', height: '100vh', position: 'absolute', top: 0, left: 0 }}
      ></div>

      <div id="top-actions" className="floating-panel">
        <button
          className={`action-btn ${activeTool === TOOLS.PREVIEW ? 'active' : ''}`}
          onClick={() => handleToolClick(TOOLS.PREVIEW)}
          title="框选区域并导出为试卷风格图片"
        >
          <IconPreview />
          <span>预览与导出</span>
        </button>
      </div>

      <div id="toolbar" className="floating-panel">
        {TOOL_GROUPS.map((group) => (
          <div key={group.name} className="tool-group">
            <div className="tool-group-label">{group.name}</div>
            <div className="tool-grid">
            {group.tools.map((item) => (
              <button
                key={item.tool}
                className={`tool-btn ${activeTool === item.tool ? 'active' : ''}`}
                title={item.title}
                aria-label={item.title}
                aria-pressed={activeTool === item.tool}
                onClick={() => handleToolClick(item.tool)}
              >
                {item.icon}
              </button>
            ))}
            </div>
          </div>
        ))}
      </div>

      <div id="status-bar" className={`floating-panel ${statusTone}`}>
        <span className="status-dot"></span>
        <span>{status}</span>
      </div>

      <div id="tool-hint" className="floating-panel">
        <div className="eyebrow">当前工具</div>
        <strong>{activeTool}</strong>
        <p>{activeGuide}</p>
        <div className="shortcut-row">
          <span>Esc 取消</span>
          <span>Shift 约束</span>
        </div>
      </div>

      <div id="view-controls" className="floating-panel" aria-label="画布视图控制">
        <button onClick={() => adjustZoom(0.8)} aria-label="放大">+</button>
        <button onClick={() => adjustZoom(1.25)} aria-label="缩小">−</button>
        <button onClick={resetView} aria-label="复位视图">复位</button>
      </div>

      <div id="chat-container" className="floating-panel">
        <div id="chat-header">
          <span>AI 几何助手</span>
          <small>自然语言生成几何构造</small>
        </div>
        <div id="chat-messages" ref={chatMessagesRef}>
          {messages.map((message, index) => (
            <div key={index} className={`message ${message.role}`}>{message.text}</div>
          ))}
        </div>
        <div id="prompt-suggestions" aria-label="示例指令">
          {PROMPT_SUGGESTIONS.map((suggestion) => (
            <button key={suggestion} onClick={() => setInputText(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
        <div id="chat-input-area">
          <input
            type="text"
            id="chat-input"
            placeholder="描述题目意图..."
            value={inputText}
            disabled={isSending}
            onChange={(event) => setInputText(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && handleSendMessage()}
          />
          <button id="send-btn" disabled={!canSend} onClick={handleSendMessage}>
            {isSending ? '分析中' : '发送'}
          </button>
        </div>
      </div>

      {previewData && (
        <PreviewModal
          data={previewData}
          board={board}
          onClose={() => setPreviewData(null)}
        />
      )}
    </>
  );
}
