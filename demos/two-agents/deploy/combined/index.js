// FlowGrid Two Agents - Combined Entry Point
// Each function app will only trigger on its configured queue
require('./coordinator/index.js');
require('./specialist/index.js');
console.log('FlowGrid Agents loaded');
