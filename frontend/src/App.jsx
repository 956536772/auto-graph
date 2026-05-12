import React, { useEffect, useRef, useState } from 'react';
import JXG from 'jsxgraph';
import { ShapeRegistry } from './lib/ShapeRegistry';
import { DrawingEngine } from './lib/DrawingEngine';
import './App.css';

const IconSelect = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path><path d="M13 13l6 6"></path></svg>;
const IconPoint = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle></svg>;
const IconSegment = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><circle cx="5" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></svg>;
const IconCircle = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"></circle></svg>;
const IconUndo = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"></path></svg>;
const IconClear = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>;

export default function App() {
  const boardRef = useRef(null);
  const registryRef = useRef(new ShapeRegistry());
  const engineRef = useRef(null);
  const [activeTool, setActiveTool] = useState('选择');
  const [status, setStatus] = useState('就绪 - 请在右侧输入绘图需求（右键平移，左键选择）');
  const [messages, setMessages] = useState([{ role: 'ai', text: '你好！我是你的几何助手。你可以告诉我你想画什么，比如：“画一个正方形 ABCD”。' }]);
  const [inputText, setInputText] = useState('');
  const chatMessagesRef = useRef(null);

  // 绘图状态机 Ref
  const drawState = useRef({
    point1Id: null,
    ghostPoint: null,
    ghostShape: null,
    tempPoints: []
  });

  const getTargetUnderMouse = (board, e) => {
    const elements = board.getAllObjectsUnderMouse(e);
    if (!elements || elements.length === 0) return null;
    const point = elements.find(el => el.elType === 'point' || el.elType === 'glider');
    if (point) return { type: 'point', obj: point };
    const path = elements.find(el => el.elType === 'segment' || el.elType === 'line' || el.elType === 'circle');
    if (path) return { type: 'path', obj: path };
    return null;
  };

  const resetDrawState = (board) => {
    drawState.current.point1Id = null;
    if (drawState.current.ghostShape) { board.removeObject(drawState.current.ghostShape); drawState.current.ghostShape = null; }
    if (drawState.current.ghostPoint) { board.removeObject(drawState.current.ghostPoint); drawState.current.ghostPoint = null; }
  };

  useEffect(() => {
    const board = JXG.JSXGraph.initBoard(boardRef.current, {
      boundingbox: [-10, 10, 10, -10], 
      axis: false, grid: true, showCopyright: false, keepaspectratio: true,
      shownavigation: true, browserContext: 'ignore',
      pan: { enabled: true, needTwoFingers: false, needShift: false },
      zoom: { wheel: true, needShift: false }
    });
    engineRef.current = new DrawingEngine(board, registryRef.current);

    const handleResize = () => {
      if(board) board.resizeContainer(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      JXG.JSXGraph.freeBoard(board);
    };
  }, []);

  const activeToolRef = useRef(activeTool);
  useEffect(() => {
    activeToolRef.current = activeTool;
    if (engineRef.current) {
        const board = engineRef.current.board;
        board.setAttribute({ browsing: { enabled: (activeTool === '选择') } });
        resetDrawState(board);
    }
  }, [activeTool]);

  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const board = engineRef.current?.board;
    if (!board) return;

    const onDown = (e) => {
      const tool = activeToolRef.current;
      if (tool === '选择' || tool === '撤销') return;
      
      const target = getTargetUnderMouse(board, e);
      const coords = board.getUsrCoordsOfMouse(e);
      let x = coords[0], y = coords[1];
      let currentPointId = null;
      const engine = engineRef.current;
      const registry = registryRef.current;

      if (target && target.type === 'point' && target.obj.registryId) {
          currentPointId = target.obj.registryId;
          setStatus(`选中已有点`);
      } else if (target && target.type === 'path' && target.obj.registryId) {
          currentPointId = `glider_${Date.now()}`;
          engine.execute([{ action: 'glider', params: { x, y, path: target.obj.registryId }, result_id: currentPointId }]);
          setStatus(`创建路径上的点`);
      } else {
          currentPointId = `p_${Date.now()}`;
          engine.execute([{ action: 'place_point', params: { x, y }, result_id: currentPointId }]);
      }

      if (tool === '点') {
          setStatus('点创建完成');
      } else if (tool === '线段' || tool === '圆') {
          if (!drawState.current.point1Id) {
              drawState.current.point1Id = currentPointId;
              setStatus(`已确定起点，请点击第二个点`);
              const p1Obj = registry.get(drawState.current.point1Id);
              drawState.current.ghostPoint = board.create('point', [x, y], { visible: false, name: '' });
              
              if (tool === '线段') {
                  drawState.current.ghostShape = board.create('segment', [p1Obj, drawState.current.ghostPoint], { 
                      dash: 2, strokeColor: '#999', strokeWidth: 1, highlight: false 
                  });
              } else if (tool === '圆') {
                  drawState.current.ghostShape = board.create('circle', [p1Obj, drawState.current.ghostPoint], { 
                      dash: 2, strokeColor: '#999', strokeWidth: 1, fillColor: 'none', highlight: false 
                  });
              }
          } else {
              if (drawState.current.point1Id !== currentPointId) {
                  const action = tool === '线段' ? 'segment' : 'circle';
                  const params = tool === '线段' ? { p1: drawState.current.point1Id, p2: currentPointId } : { center: drawState.current.point1Id, through: currentPointId };
                  resetDrawState(board);
                  engine.execute([{ action: action, params: params, result_id: `shape_${Date.now()}` }]);
                  setStatus(`${tool}绘制完成`);
              } else {
                  setStatus('起点和终点不能相同，请重新选择');
              }
          }
      }
    };

    const onMove = (e) => {
        const tool = activeToolRef.current;
        if (drawState.current.point1Id && drawState.current.ghostPoint) {
            const coords = board.getUsrCoordsOfMouse(e);
            drawState.current.ghostPoint.setPosition(JXG.COORDS_BY_USER, coords);
            board.update();
        }
    };

    board.on('down', onDown);
    board.on('move', onMove);

    return () => {
        board.off('down', onDown);
        board.off('move', onMove);
    };
  }, []);

  const handleToolClick = (tool) => {
    if (tool === '清空') {
      window.location.reload();
      return;
    }
    if (tool === '撤销') {
      const id = registryRef.current.undo(engineRef.current.board);
      setStatus(id ? `已撤销上一步操作` : '没有可撤销的操作');
      resetDrawState(engineRef.current.board);
      return;
    }
    setActiveTool(tool);
  };

  const handleSendMessage = async () => {
    const text = inputText.trim();
    if (!text) return;
    
    setMessages(prev => [...prev, { role: 'user', text }]);
    setInputText('');
    setStatus('AI 正在分析题意并绘图...');

    try {
        const response = await fetch('http://localhost:8080/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text,
                context: JSON.stringify(registryRef.current.serialize())
            })
        });
        const data = await response.json();
        
        if (data.instructions && data.instructions.length > 0) {
            engineRef.current.execute(data.instructions);
        }
        setMessages(prev => [...prev, { role: 'ai', text: data.responseText }]);
        setStatus('就绪');
    } catch (e) {
        console.error(e);
        setMessages(prev => [...prev, { role: 'ai', text: "抱歉，无法连接到后端服务。" }]);
        setStatus('错误');
    }
  };

  return (
    <>
      <div ref={boardRef} className="jxgbox" style={{ width: '100vw', height: '100vh', position: 'absolute', top: 0, left: 0 }}></div>

      <div id="toolbar" className="floating-panel">
        <button className={`tool-btn ${activeTool === '选择' ? 'active' : ''}`} title="选择" onClick={() => handleToolClick('选择')}>
           <IconSelect />
        </button>
        <button className={`tool-btn ${activeTool === '点' ? 'active' : ''}`} title="点" onClick={() => handleToolClick('点')}>
           <IconPoint />
        </button>
        <button className={`tool-btn ${activeTool === '线段' ? 'active' : ''}`} title="线段" onClick={() => handleToolClick('线段')}>
           <IconSegment />
        </button>
        <button className={`tool-btn ${activeTool === '圆' ? 'active' : ''}`} title="圆" onClick={() => handleToolClick('圆')}>
           <IconCircle />
        </button>
        <div style={{ height: '1px', background: 'rgba(0,0,0,0.1)', margin: '5px 0' }}></div>
        <button className="tool-btn" title="撤销" onClick={() => handleToolClick('撤销')}>
            <IconUndo />
        </button>
        <button className="tool-btn" title="清空" onClick={() => handleToolClick('清空')}>
            <IconClear />
        </button>
      </div>

      <div id="status-bar" className="floating-panel">
        {status}
      </div>

      <div id="chat-container" className="floating-panel">
        <div id="chat-header"><span>AI 几何助手</span></div>
        <div id="chat-messages" ref={chatMessagesRef}>
          {messages.map((m, i) => (
              <div key={i} className={`message ${m.role}`}>{m.text}</div>
          ))}
        </div>
        <div id="chat-input-area">
            <input 
                type="text" 
                id="chat-input" 
                placeholder="描述题目意图..." 
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
            />
            <button id="send-btn" onClick={handleSendMessage}>发送</button>
        </div>
      </div>
    </>
  );
}