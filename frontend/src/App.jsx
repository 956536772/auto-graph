import { useEffect, useRef, useState } from 'react';
import JXG from 'jsxgraph';
import { ShapeRegistry } from './lib/ShapeRegistry';
import { DrawingEngine } from './lib/DrawingEngine';
import { ManualDrawingController } from './lib/manualTools/ManualDrawingController.js';
import { TOOLS } from './lib/manualTools/constants.js';
import { ensurePointLabelEditor, getNextPointLabel } from './lib/manualTools/labels.js';
import './App.css';

const IconSelect = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path><path d="M13 13l6 6"></path></svg>;
const IconPoint = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle></svg>;
const IconSegment = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><circle cx="5" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></svg>;
const IconCircle = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"></circle></svg>;
const IconUndo = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"></path></svg>;
const IconClear = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>;
const ToolGlyph = ({ text }) => <span className="tool-glyph">{text}</span>;

const TOOL_GROUPS = [
  [
    { tool: TOOLS.SELECT, title: '选择', icon: <IconSelect /> },
    { tool: TOOLS.POINT, title: '点', icon: <IconPoint /> },
    { tool: TOOLS.SEGMENT, title: '线段', icon: <IconSegment /> },
    { tool: TOOLS.CIRCLE, title: '圆', icon: <IconCircle /> },
    { tool: TOOLS.RECTANGLE, title: '矩形/正方形', icon: <ToolGlyph text="▭" /> },
    { tool: TOOLS.TRIANGLE, title: '等腰/等边三角形', icon: <ToolGlyph text="△" /> }
  ],
  [
    { tool: TOOLS.LABEL, title: '点标签', icon: <ToolGlyph text="A" /> },
    { tool: TOOLS.ANGLE, title: '角标记', icon: <ToolGlyph text="∠" /> },
    { tool: TOOLS.MIDPOINT, title: '中点', icon: <ToolGlyph text="M" /> },
    { tool: TOOLS.PARALLEL, title: '平行', icon: <ToolGlyph text="∥" /> },
    { tool: TOOLS.PERPENDICULAR, title: '垂直', icon: <ToolGlyph text="⊥" /> },
    { tool: TOOLS.ANGLE_BISECTOR, title: '角平分线', icon: <ToolGlyph text="∠/" /> }
  ],
  [
    { tool: TOOLS.UNDO, title: '撤销', icon: <IconUndo /> },
    { tool: TOOLS.CLEAR, title: '清空', icon: <IconClear /> }
  ]
];

export default function App() {
  const boardRef = useRef(null);
  const registryRef = useRef(new ShapeRegistry());
  const engineRef = useRef(null);
  const controllerRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const [activeTool, setActiveTool] = useState(TOOLS.SELECT);
  const [status, setStatus] = useState('就绪 - 请在右侧输入绘图需求（右键平移，左键选择）');
  const [messages, setMessages] = useState([{ role: 'ai', text: '你好！我是你的几何助手。你可以让我画三角形、作外接圆/内切圆、过圆上一点作切线，或求两圆交点。' }]);
  const [inputText, setInputText] = useState('');

  useEffect(() => {
    const board = JXG.JSXGraph.initBoard(boardRef.current, {
      boundingbox: [-10, 10, 10, -10],
      axis: false,
      grid: true,
      showCopyright: false,
      keepaspectratio: true,
      shownavigation: true,
      browserContext: 'ignore',
      pan: { enabled: true, needTwoFingers: false, needShift: false },
      zoom: { wheel: true, needShift: false }
    });

    const decorateObject = (obj) => {
      if (obj.elType !== 'point' && obj.elType !== 'glider') {
        return;
      }
      ensurePointLabelEditor(obj, {
        board,
        suggestLabel: () => getNextPointLabel(registryRef.current)
      });
    };

    engineRef.current = new DrawingEngine(board, registryRef.current, {
      onObjectCreated: decorateObject
    });
    controllerRef.current = new ManualDrawingController({
      board,
      engine: engineRef.current,
      registry: registryRef.current,
      onStatusChange: setStatus,
      onToolChange: setActiveTool
    });

    const handleResize = () => {
      board.resizeContainer(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      controllerRef.current?.destroy();
      controllerRef.current = null;
      JXG.JSXGraph.freeBoard(board);
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
      window.location.reload();
      return;
    }

    if (tool === TOOLS.UNDO) {
      const board = engineRef.current?.board;
      const removedId = board ? registryRef.current.undo(board) : null;
      controllerRef.current?.resetState();
      setStatus(removedId ? '已撤销上一步操作' : '没有可撤销的操作');
      return;
    }

    setActiveTool(tool);
  };

  const handleSendMessage = async () => {
    const text = inputText.trim();
    if (!text) {
      return;
    }

    setMessages((prev) => [...prev, { role: 'user', text }]);
    setInputText('');
    setStatus('AI 正在分析题意并绘图...');

    try {
      const context = registryRef.current.serialize();
      const response = await fetch('http://localhost:8080/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          context
        })
      });
      const data = await response.json();

      if (data.instructions && data.instructions.length > 0) {
        engineRef.current.execute(data.instructions);
      }

      setMessages((prev) => [...prev, { role: 'ai', text: data.responseText || '已处理。' }]);
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
    }
  };

  return (
    <>
      <div
        ref={boardRef}
        className="jxgbox"
        style={{ width: '100vw', height: '100vh', position: 'absolute', top: 0, left: 0 }}
      ></div>

      <div id="toolbar" className="floating-panel">
        {TOOL_GROUPS.map((group, groupIndex) => (
          <div key={groupIndex} className="tool-group">
            {group.map((item) => (
              <button
                key={item.tool}
                className={`tool-btn ${activeTool === item.tool ? 'active' : ''}`}
                title={item.title}
                onClick={() => handleToolClick(item.tool)}
              >
                {item.icon}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div id="status-bar" className="floating-panel">
        {status}
      </div>

      <div id="chat-container" className="floating-panel">
        <div id="chat-header"><span>AI 几何助手</span></div>
        <div id="chat-messages" ref={chatMessagesRef}>
          {messages.map((message, index) => (
            <div key={index} className={`message ${message.role}`}>{message.text}</div>
          ))}
        </div>
        <div id="chat-input-area">
          <input
            type="text"
            id="chat-input"
            placeholder="描述题目意图..."
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && handleSendMessage()}
          />
          <button id="send-btn" onClick={handleSendMessage}>发送</button>
        </div>
      </div>
    </>
  );
}
