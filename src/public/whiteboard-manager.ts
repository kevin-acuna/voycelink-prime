// @ts-nocheck
/**
 * Whiteboard Manager
 * 
 * Manages collaborative whiteboard using Fabric.js and OpenVidu signals
 */

class WhiteboardManager {
    constructor() {
        this.canvas = null;
        this.session = null;
        this.isOpen = false;
        this.isDrawing = false;
        this.canManage = false;
        this.canDraw = false;
        
        // Drawing settings
        this.currentColor = '#ffffff';
        this.currentWidth = 3;
        this.currentTool = 'pencil'; // pencil, eraser, select, rectangle, circle, line
        
        // Shape drawing state
        this.isDrawingShape = false;
        this.shapeStartX = 0;
        this.shapeStartY = 0;
        this.currentShape = null;
        
        // History for undo/redo
        this.history = [];
        this.historyIndex = -1;
        this.maxHistory = 50;
        
        // Callbacks
        this.onOpen = null;
        this.onClose = null;
        this.onPersistState = null;
        this.roomTarget = {
            type: 'main',
            breakoutRoomId: null,
        };
    }

    /**
     * Initialize the whiteboard with OpenVidu session
     */
    initialize(session, options = {}) {
        this.session = session;
        this.roomTarget = options.roomTarget || this.roomTarget;
        this.onPersistState = options.onPersistState || null;
        this.setupSignalHandlers();
        console.log('[Whiteboard] Initialized');
        this.applyRoomState(options.initialState || { isOpen: false, canvasState: null });
    }

    setAccess({ canManage = false, canDraw = false } = {}) {
        this.canManage = canManage;
        this.canDraw = canDraw;
        this.updateToolbarAccess();
        this.updateCanvasAccess();
    }

    /**
     * Setup Fabric.js canvas (called once when first opening whiteboard)
     */
    setupCanvas() {
        const container = document.querySelector('.whiteboard-canvas-container');
        if (!container) return;

        // Don't recreate if canvas already exists
        if (this.canvas) return;

        // Set canvas size to container size
        const rect = container.getBoundingClientRect();
        
        // Initialize Fabric.js canvas
        this.canvas = new fabric.Canvas('whiteboardCanvas', {
            isDrawingMode: true,
            width: rect.width || 800,
            height: rect.height || 500,
            backgroundColor: '#1a1a2e',
            selection: false
        });

        // Configure brush
        this.updateBrush();

        // Handle path creation (when user finishes drawing a stroke)
        this.canvas.on('path:created', (e) => {
            this.addToHistory();
            this.broadcastObject(e.path, 'add');
        });

        // Handle object modifications
        this.canvas.on('object:modified', (e) => {
            this.addToHistory();
            this.broadcastObject(e.target, 'modify');
        });

        // Handle window resize
        window.addEventListener('resize', () => this.resizeCanvas());
        
        // Load pending sync state if any (received before canvas was ready)
        if (this._pendingSyncState) {
            this.loadState(this._pendingSyncState);
            this._pendingSyncState = null;
        }
        
        // Process pending objects if any (received before canvas was ready)
        if (this._pendingObjects && this._pendingObjects.length > 0) {
            this._pendingObjects.forEach(data => this.handleRemoteObject(data));
            this._pendingObjects = [];
        }
    }

    /**
     * Resize canvas to fit container
     */
    resizeCanvas() {
        if (!this.canvas || !this.isOpen) return;
        
        const container = document.querySelector('.whiteboard-canvas-container');
        if (!container) return;

        const rect = container.getBoundingClientRect();
        this.canvas.setDimensions({
            width: rect.width,
            height: rect.height
        });
        this.canvas.renderAll();
    }

    /**
     * Setup toolbar event handlers
     */
    setupToolbar() {
        // Tool buttons
        document.getElementById('toolPencil')?.addEventListener('click', () => this.setTool('pencil'));
        document.getElementById('toolRectangle')?.addEventListener('click', () => this.setTool('rectangle'));
        document.getElementById('toolCircle')?.addEventListener('click', () => this.setTool('circle'));
        document.getElementById('toolLine')?.addEventListener('click', () => this.setTool('line'));
        document.getElementById('toolText')?.addEventListener('click', () => this.setTool('text'));
        document.getElementById('toolEraser')?.addEventListener('click', () => this.setTool('eraser'));
        document.getElementById('toolSelect')?.addEventListener('click', () => this.setTool('select'));

        // Color buttons
        document.querySelectorAll('.color-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentColor = e.target.dataset.color;
                this.updateBrush();
            });
        });

        // Stroke width
        document.getElementById('strokeWidth')?.addEventListener('input', (e) => {
            this.currentWidth = parseInt(e.target.value);
            this.updateBrush();
        });

        // Undo/Redo/Clear
        document.getElementById('toolUndo')?.addEventListener('click', () => this.undo());
        document.getElementById('toolRedo')?.addEventListener('click', () => this.redo());
        document.getElementById('toolClear')?.addEventListener('click', () => this.clearAll());

        // Close button
        document.getElementById('closeWhiteboardBtn')?.addEventListener('click', () => {
            if (!this.canManage) return;
            this.close();
        });

        this.updateToolbarAccess();
    }

    updateToolbarAccess() {
        const wrapper = document.getElementById('whiteboardWrapper');
        const toolbar = wrapper?.querySelector('.whiteboard-toolbar');
        const closeBtn = document.getElementById('closeWhiteboardBtn');
        const interactiveControls = [
            'toolPencil',
            'toolRectangle',
            'toolCircle',
            'toolLine',
            'toolText',
            'toolEraser',
            'toolSelect',
            'toolUndo',
            'toolRedo',
            'toolClear',
            'strokeWidth',
        ];

        document.querySelectorAll('.color-btn').forEach((btn) => {
            btn.disabled = !this.canDraw;
        });

        interactiveControls.forEach((id) => {
            const element = document.getElementById(id);
            if (element) {
                element.disabled = !this.canDraw;
            }
        });

        if (toolbar) {
            toolbar.classList.toggle('whiteboard-toolbar-readonly', !this.canDraw);
        }

        if (closeBtn) {
            closeBtn.style.display = this.canManage ? '' : 'none';
        }
    }

    updateCanvasAccess() {
        if (!this.canvas) return;

        if (!this.canDraw) {
            this.canvas.isDrawingMode = false;
            this.canvas.selection = false;
            this.canvas.forEachObject((obj) => {
                obj.selectable = false;
                obj.evented = false;
            });
            this.canvas.discardActiveObject();
            this.canvas.renderAll();
            this.updateStatus('Viewing');
            return;
        }

        this.canvas.forEachObject((obj) => {
            obj.selectable = true;
            obj.evented = true;
        });
        this.setTool(this.currentTool || 'pencil');
        this.canvas.renderAll();
    }

    applyRoomState(roomState = {}) {
        const nextState = {
            isOpen: Boolean(roomState.isOpen),
            canvasState: roomState.canvasState || null,
        };

        if (nextState.isOpen) {
            this.openAsViewer({ canvasState: nextState.canvasState });
        } else {
            this.closeAsViewer();
        }
    }

    persistState(updates = {}) {
        if (typeof this.onPersistState !== 'function') {
            return;
        }

        const payload = {
            ...updates,
        };

        this.onPersistState(payload).catch((error) => {
            console.error('Error persisting whiteboard state:', error);
        });
    }

    /**
     * Set active tool
     */
    setTool(tool) {
        if (!this.canDraw) {
            return;
        }

        this.currentTool = tool;
        
        // Update UI - remove active from all tool buttons
        const toolButtons = ['toolPencil', 'toolRectangle', 'toolCircle', 'toolLine', 'toolText', 'toolEraser', 'toolSelect'];
        document.querySelectorAll('.toolbar-btn').forEach(btn => {
            if (toolButtons.includes(btn.id)) {
                btn.classList.remove('active');
            }
        });
        
        // Set active on current tool
        const toolId = `tool${tool.charAt(0).toUpperCase() + tool.slice(1)}`;
        document.getElementById(toolId)?.classList.add('active');

        // Update canvas mode based on tool type
        const shapeTools = ['rectangle', 'circle', 'line'];
        
        if (tool === 'select') {
            this.canvas.isDrawingMode = false;
            this.canvas.selection = true;
            this.removeShapeListeners();
            this.removeTextListener();
            this.updateStatus('Select');
        } else if (shapeTools.includes(tool)) {
            this.canvas.isDrawingMode = false;
            this.canvas.selection = false;
            this.setupShapeListeners();
            this.removeTextListener();
            this.updateStatus(tool.charAt(0).toUpperCase() + tool.slice(1));
        } else if (tool === 'text') {
            this.canvas.isDrawingMode = false;
            this.canvas.selection = false;
            this.removeShapeListeners();
            this.setupTextListener();
            this.updateStatus('Text - Click to add');
        } else {
            this.canvas.isDrawingMode = true;
            this.canvas.selection = false;
            this.removeShapeListeners();
            this.removeTextListener();
            this.updateBrush();
            this.updateStatus(tool === 'eraser' ? 'Eraser' : 'Drawing');
        }
    }
    
    /**
     * Setup click listener for text tool
     */
    setupTextListener() {
        this.removeTextListener();
        
        this._onTextClick = (opt) => this.onTextClick(opt);
        this.canvas.on('mouse:down', this._onTextClick);
    }
    
    /**
     * Remove text click listener
     */
    removeTextListener() {
        if (this._onTextClick) {
            this.canvas.off('mouse:down', this._onTextClick);
            this._onTextClick = null;
        }
    }
    
    /**
     * Handle click for text tool - add editable text
     */
    onTextClick(opt) {
        if (!this.canDraw) return;
        if (this.currentTool !== 'text') return;
        
        const pointer = this.canvas.getPointer(opt.e);
        
        // Create editable text
        const text = new fabric.IText('Text', {
            left: pointer.x,
            top: pointer.y,
            fontFamily: 'Arial, sans-serif',
            fontSize: Math.max(16, this.currentWidth * 6),
            fill: this.currentColor,
            editable: true
        });
        
        this.canvas.add(text);
        this.canvas.setActiveObject(text);
        text.enterEditing();
        text.selectAll();
        
        // When editing ends, broadcast and save to history
        text.on('editing:exited', () => {
            if (text.text.trim() === '' || text.text === 'Text') {
                // Remove empty text
                this.canvas.remove(text);
            } else {
                this.addToHistory();
                this.broadcastObject(text, 'add');
                this.persistState({ canvasState: JSON.stringify(this.canvas.toJSON()) });
            }
        });
        
        this.canvas.renderAll();
    }
    
    /**
     * Setup mouse listeners for shape drawing
     */
    setupShapeListeners() {
        this.removeShapeListeners(); // Remove existing listeners first
        
        this._onMouseDown = (opt) => this.onShapeMouseDown(opt);
        this._onMouseMove = (opt) => this.onShapeMouseMove(opt);
        this._onMouseUp = (opt) => this.onShapeMouseUp(opt);
        
        this.canvas.on('mouse:down', this._onMouseDown);
        this.canvas.on('mouse:move', this._onMouseMove);
        this.canvas.on('mouse:up', this._onMouseUp);
    }
    
    /**
     * Remove shape drawing listeners
     */
    removeShapeListeners() {
        if (this._onMouseDown) {
            this.canvas.off('mouse:down', this._onMouseDown);
            this.canvas.off('mouse:move', this._onMouseMove);
            this.canvas.off('mouse:up', this._onMouseUp);
        }
    }
    
    /**
     * Handle mouse down for shape drawing
     */
    onShapeMouseDown(opt) {
        if (!this.canDraw) return;
        if (!['rectangle', 'circle', 'line'].includes(this.currentTool)) return;
        
        this.isDrawingShape = true;
        const pointer = this.canvas.getPointer(opt.e);
        this.shapeStartX = pointer.x;
        this.shapeStartY = pointer.y;
        
        // Create the shape
        if (this.currentTool === 'rectangle') {
            this.currentShape = new fabric.Rect({
                left: pointer.x,
                top: pointer.y,
                width: 0,
                height: 0,
                fill: 'transparent',
                stroke: this.currentColor,
                strokeWidth: this.currentWidth,
                selectable: true
            });
        } else if (this.currentTool === 'circle') {
            this.currentShape = new fabric.Ellipse({
                left: pointer.x,
                top: pointer.y,
                rx: 0,
                ry: 0,
                fill: 'transparent',
                stroke: this.currentColor,
                strokeWidth: this.currentWidth,
                selectable: true
            });
        } else if (this.currentTool === 'line') {
            this.currentShape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
                stroke: this.currentColor,
                strokeWidth: this.currentWidth,
                selectable: true
            });
        }
        
        this.canvas.add(this.currentShape);
    }
    
    /**
     * Handle mouse move for shape drawing
     */
    onShapeMouseMove(opt) {
        if (!this.canDraw) return;
        if (!this.isDrawingShape || !this.currentShape) return;
        
        const pointer = this.canvas.getPointer(opt.e);
        
        if (this.currentTool === 'rectangle') {
            const width = pointer.x - this.shapeStartX;
            const height = pointer.y - this.shapeStartY;
            
            this.currentShape.set({
                left: width > 0 ? this.shapeStartX : pointer.x,
                top: height > 0 ? this.shapeStartY : pointer.y,
                width: Math.abs(width),
                height: Math.abs(height)
            });
        } else if (this.currentTool === 'circle') {
            const rx = Math.abs(pointer.x - this.shapeStartX) / 2;
            const ry = Math.abs(pointer.y - this.shapeStartY) / 2;
            
            this.currentShape.set({
                left: Math.min(pointer.x, this.shapeStartX),
                top: Math.min(pointer.y, this.shapeStartY),
                rx: rx,
                ry: ry
            });
        } else if (this.currentTool === 'line') {
            this.currentShape.set({
                x2: pointer.x,
                y2: pointer.y
            });
        }
        
        this.canvas.renderAll();
    }
    
    /**
     * Handle mouse up for shape drawing
     */
    onShapeMouseUp(opt) {
        if (!this.canDraw) return;
        if (!this.isDrawingShape || !this.currentShape) return;
        
        this.isDrawingShape = false;
        this.currentShape.setCoords();
        this.addToHistory();
        this.broadcastObject(this.currentShape, 'add');
        this.persistState({ canvasState: JSON.stringify(this.canvas.toJSON()) });
        this.currentShape = null;
    }

    /**
     * Update brush settings
     */
    updateBrush() {
        if (!this.canvas) return;

        if (this.currentTool === 'eraser') {
            // Eraser mode - draw with background color
            this.canvas.freeDrawingBrush.color = '#1a1a2e';
            this.canvas.freeDrawingBrush.width = this.currentWidth * 3;
        } else {
            this.canvas.freeDrawingBrush.color = this.currentColor;
            this.canvas.freeDrawingBrush.width = this.currentWidth;
        }
    }

    /**
     * Update status display
     */
    updateStatus(status) {
        const statusEl = document.getElementById('whiteboardStatus');
        if (statusEl) {
            statusEl.textContent = status;
        }
    }

    /**
     * Add current state to history
     */
    addToHistory() {
        // Remove any future states if we're not at the end
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }

        // Add current state
        this.history.push(JSON.stringify(this.canvas.toJSON()));
        
        // Limit history size
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        } else {
            this.historyIndex++;
        }
    }

    /**
     * Undo last action
     */
    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.loadState(this.history[this.historyIndex]);
            this.broadcastState('undo');
        }
    }

    /**
     * Redo last undone action
     */
    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.loadState(this.history[this.historyIndex]);
            this.broadcastState('redo');
        }
    }

    /**
     * Load canvas state from JSON
     */
    loadState(stateJson) {
        if (!this.canvas || !stateJson) return;
        
        this.canvas.loadFromJSON(JSON.parse(stateJson), () => {
            this.updateCanvasAccess();
            this.canvas.renderAll();
        });
    }

    /**
     * Clear all objects from canvas
     */
    clearAll() {
        if (!this.canvas) return;
        
        if (confirm('Clear the entire whiteboard?')) {
            this.canvas.clear();
            this.canvas.backgroundColor = '#1a1a2e';
            this.canvas.renderAll();
            this.addToHistory();
            this.broadcastClear();
            this.persistState({ canvasState: JSON.stringify(this.canvas.toJSON()) });
        }
    }

    /**
     * Setup OpenVidu signal handlers for receiving whiteboard updates
     */
    setupSignalHandlers() {
        if (!this.session) return;

        // Receive new objects
        this.session.on('signal:whiteboard-object', (event) => {
            if (event.from.connectionId === this.session.connection.connectionId) return;
            
            const data = JSON.parse(event.data);
            if (!this.canvas) {
                // Queue objects if canvas not ready
                this._pendingObjects = this._pendingObjects || [];
                this._pendingObjects.push(data);
            } else {
                this.handleRemoteObject(data);
            }
        });

        // Receive clear command
        this.session.on('signal:whiteboard-clear', (event) => {
            if (event.from.connectionId === this.session.connection.connectionId) return;
            if (!this.canvas) return;
            
            this.canvas.clear();
            this.canvas.backgroundColor = '#1a1a2e';
            this.canvas.renderAll();
        });

        // Receive full state sync (for new joiners)
        // Use flag to only accept first sync response and ignore duplicates
        this.session.on('signal:whiteboard-sync', (event) => {
            if (event.from.connectionId === this.session.connection.connectionId) return;
            
            const data = JSON.parse(event.data);
            if (data.state) {
                // Only load if we don't have content yet or canvas is empty
                if (!this.canvas) {
                    this._pendingSyncState = data.state;
                } else {
                    this.loadState(data.state);
                }
            }
        });

        // Request sync when whiteboard opens or new participant joins
        this.session.on('signal:whiteboard-request-sync', (event) => {
            if (event.from.connectionId === this.session.connection.connectionId) return;
            
            // Send current state and open status to requester
            if (this.canvas && this.isOpen) {
                // Send the canvas content for active room peers
                setTimeout(() => {
                    this.session.signal({
                        data: JSON.stringify({ state: JSON.stringify(this.canvas.toJSON()) }),
                        type: 'whiteboard-sync',
                        to: [event.from]
                    }).catch(err => console.error('Error sending whiteboard sync:', err));
                }, 200);
            }
        });
        
    }
    
    /**
     * Open whiteboard as viewer (triggered by remote signal)
     */
    openAsViewer(options = {}) {
        const wrapper = document.getElementById('whiteboardWrapper');
        const videoGrid = document.getElementById('videoGrid');
        const btn = document.getElementById('toggleWhiteboard');
        
        if (wrapper && videoGrid) {
            wrapper.style.display = 'flex';
            videoGrid.classList.add('whiteboard-mode');
            this.isOpen = true;
            
            setTimeout(() => {
                if (!this.canvas) {
                    this.setupCanvas();
                    this.setupToolbar();
                } else {
                    this.resizeCanvas();
                }

                if (options.canvasState) {
                    this.loadState(options.canvasState);
                } else if (!this.canvas || this.canvas.getObjects().length === 0) {
                    this.requestSync();
                }

                this.updateToolbarAccess();
                this.updateCanvasAccess();
                
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                }
            }, 100);
            
            if (btn) btn.classList.add('active');
        }
    }
    
    /**
     * Close whiteboard as viewer (triggered by remote signal)
     */
    closeAsViewer() {
        const wrapper = document.getElementById('whiteboardWrapper');
        const videoGrid = document.getElementById('videoGrid');
        const btn = document.getElementById('toggleWhiteboard');
        
        if (wrapper && videoGrid) {
            wrapper.style.display = 'none';
            videoGrid.classList.remove('whiteboard-mode');
            this.isOpen = false;
            
            if (btn) btn.classList.remove('active');
        }
    }

    /**
     * Broadcast object addition/modification to other participants
     */
    broadcastObject(obj, action) {
        if (!this.session) return;

        this.session.signal({
            data: JSON.stringify({
                action: action,
                object: obj.toJSON()
            }),
            type: 'whiteboard-object'
        }).catch(err => console.error('Error broadcasting whiteboard object:', err));
        this.persistState({ canvasState: JSON.stringify(this.canvas.toJSON()) });
    }

    /**
     * Broadcast clear command
     */
    broadcastClear() {
        if (!this.session) return;

        this.session.signal({
            data: JSON.stringify({ action: 'clear' }),
            type: 'whiteboard-clear'
        }).catch(err => console.error('Error broadcasting whiteboard clear:', err));
    }

    /**
     * Broadcast state (for undo/redo sync)
     */
    broadcastState(action) {
        if (!this.session || !this.canvas) return;

        this.session.signal({
            data: JSON.stringify({
                action: action,
                state: JSON.stringify(this.canvas.toJSON())
            }),
            type: 'whiteboard-sync'
        }).catch(err => console.error('Error broadcasting whiteboard state:', err));
        this.persistState({ canvasState: JSON.stringify(this.canvas.toJSON()) });
    }

    /**
     * Handle remote object addition/modification
     */
    handleRemoteObject(data) {
        if (!this.canvas) return;

        fabric.util.enlivenObjects([data.object], (objects) => {
            objects.forEach(obj => {
                obj.selectable = this.canDraw;
                obj.evented = this.canDraw;
                this.canvas.add(obj);
            });
            this.updateCanvasAccess();
            this.canvas.renderAll();
        });
    }

    /**
     * Request sync from other participants
     */
    requestSync() {
        if (!this.session) return;

        this.session.signal({
            data: JSON.stringify({ request: true }),
            type: 'whiteboard-request-sync'
        }).catch(err => console.error('Error requesting whiteboard sync:', err));
    }

    /**
     * Open the whiteboard (embedded in video grid)
     */
    open() {
        if (!this.canManage) {
            return;
        }

        const wrapper = document.getElementById('whiteboardWrapper');
        const videoGrid = document.getElementById('videoGrid');
        const btn = document.getElementById('toggleWhiteboard');
        
        if (wrapper && videoGrid) {
            wrapper.style.display = 'flex';
            videoGrid.classList.add('whiteboard-mode');
            this.isOpen = true;
            
            // Only setup canvas if it doesn't exist yet
            setTimeout(() => {
                if (!this.canvas) {
                    this.setupCanvas();
                    this.setupToolbar();
                    this.requestSync(); // Request current state from others
                } else {
                    // Canvas exists, just resize it
                    this.resizeCanvas();
                }

                this.updateToolbarAccess();
                this.updateCanvasAccess();
                
                // Refresh lucide icons
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                }
            }, 100);
            
            if (btn) btn.classList.add('active');
            if (this.onOpen) this.onOpen();
            this.persistState({
                isOpen: true,
                canvasState: this.canvas ? JSON.stringify(this.canvas.toJSON()) : null,
            });
        }
    }

    /**
     * Close the whiteboard
     */
    close() {
        if (!this.canManage) {
            return;
        }

        const wrapper = document.getElementById('whiteboardWrapper');
        const videoGrid = document.getElementById('videoGrid');
        const btn = document.getElementById('toggleWhiteboard');
        
        if (wrapper && videoGrid) {
            wrapper.style.display = 'none';
            videoGrid.classList.remove('whiteboard-mode');
            this.isOpen = false;
            
            if (btn) btn.classList.remove('active');
            if (this.onClose) this.onClose();
            this.persistState({ isOpen: false });
        }
    }

    /**
     * Toggle whiteboard panel
     */
    toggle() {
        if (!this.canManage) {
            return;
        }

        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        if (this.canvas) {
            this.canvas.dispose();
            this.canvas = null;
        }
        this.session = null;
        this.history = [];
        this.historyIndex = -1;
    }
}

// Global instance
const whiteboardManager = new WhiteboardManager();
