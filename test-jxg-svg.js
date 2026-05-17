import JXG from 'jsxgraph';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><div id="box" style="width: 500px; height: 500px;"></div>');
global.window = dom.window;
global.document = dom.window.document;

const board = JXG.JSXGraph.initBoard('box', { boundingbox: [-10, 10, 10, -10], axis: false, grid: true });
board.create('point', [0, 0], { name: 'A' });
board.update();

console.log(board.renderer.dumpToDataURI());
