class UIElement {
    constructor() {
        this.el = null;
        this.children = [];
        this._value = null;
        this._baseTransform = 'none';
        this._isHovered = false;

        if (this.el) {
            this._initEventListeners();
        }
    }

    _initEventListeners() {
        ['click', 'input', 'change', 'mousedown', 'mouseup', 'keydown', 'keyup'].forEach(type => {
            this.el.addEventListener(type, (e) => {
                // Sync values automatically
                if (type === 'input' || type === 'change') {
                    this._value = (this.el.type === 'checkbox') ? this.el.checked : this.el.value;
                }
                this.onevent(type, e);
            });
        });
    }

    get text() {
        return this.el ? this.el.innerText : "";
    }

    set text(newText) {
        if (!this.el) return;
        this.el.innerText = newText;
        this.onevent("textChange", newText);
    }

    get value() {
        return this._value;
    }

    set value(newValue) {
        if (this._value === newValue) return;
        this._value = newValue;

        // Sync data to the DOM if the element supports it
        this.sync();

        // Emit change event
        this.onevent("change", newValue);
    }

    sync() {
        if (!this.el) return;
        if (this.el.type === 'checkbox') this.el.checked = !!this._value;
        else if (this.el.value !== undefined) this.el.value = this._value;
    }

    onevent(name, e) {
        const specificHandler = this[`handle_${name}`];
        if (specificHandler) specificHandler(e);
    }   

    // edge: 'top', 'bottom', 'left', 'right'
    // distance: px value from the edge
    // percent: percentage along the cross-axis
    position(edge, distance = 0, percent = 50) {
        this.el.style.position = 'fixed';
        this.el.style.margin = '0';
        ['top', 'bottom', 'left', 'right'].forEach(e => this.el.style[e] = 'auto');

        let transform = '';
        if (edge === 'top' || edge === 'bottom') {
            this.el.style[edge] = `${distance}px`;
            this.el.style.left = `${percent}%`;
            transform = 'translateX(-50%)';
        } else {
            this.el.style[edge] = `${distance}px`;
            this.el.style.top = `${percent}%`;
            transform = 'translateY(-50%)';
        }
        
        this.el.style.transform = transform;
        this._baseTransform = transform; // Save it here!
        
        return this;
    }
}

class Panel extends UIElement {
    constructor() {
        super();
        this.el = document.createElement('div');
        this.el.style.display = 'flex';
        this.el.style.flexDirection = 'column';
    }
}

class Label extends UIElement {
    constructor(text = "") {
        super();
        this.el = document.createElement('span');
        this.el.innerText = text;
        this.el.style.display = 'inline-flex';
    }
}

class Button extends UIElement {
    constructor() {
        super();
        this.el = document.createElement('button');
        this.el.style.display = 'flex';
        this.el.style.alignItems = 'center';
        this.el.style.justifyContent = 'center';
    }
}

class Slider extends UIElement {
    constructor() {
        super();
        this.el = document.createElement('input');
        this.el.type = 'range';
    }
}

class Checkbox extends UIElement {
    constructor() {
        super();
        this.el = document.createElement('input');
        this.el.type = 'checkbox';
    }

    // Checkboxes use .checked instead of .value
    sync() {
        if (this.el) {
            this.el.checked = !!this._value;
        }
    }
}

class Textarea extends UIElement {
    constructor() {
        super();
        this.el = document.createElement('textarea');
        this.el.style.display = 'flex';
    }
}

class Divider extends UIElement {
    constructor() {
        super();
        this.el = document.createElement('div');
        this.el.style.alignSelf = 'stretch';
        this.el.style.flexShrink = '0';
    }
}

export const ui = {
    defaults: {
        global: {
            boxSizing: 'border-box',
            fontFamily: 'sans-serif',
            display: 'flex'
        },
        panel: { gap: '10px', padding: '10px' },
        label: { fontSize: '14px' },
        button: { padding: '5px 10px', cursor: 'pointer', border: '0', borderRadius: '5px', flex: '1'},
        slider: { width: '100%' },
        checkbox: { cursor: 'pointer' },
        textarea: { minHeight: '100px', fontFamily: 'monospace' },
        divider: { background: '#fff' }
    },

    _create(instance, props = {}, children = []) {
        instance.children = children;

        const typeKey = instance.constructor.name.toLowerCase();
        
        // --- PRIORITY MERGING ---
        const globalDefaults = this.defaults.global || {};
        const typeDefaults = this.defaults[typeKey] || {};
        const instanceStyle = props.style || {};

        // Merge order: Global < Type < Instance
        const baseStyle = { 
            ...globalDefaults, 
            ...typeDefaults, 
            ...instanceStyle 
        };
        
        const mergedProps = { 
            ...globalDefaults,
            ...typeDefaults, 
            ...props 
        };

        // Apply base styles to DOM
        Object.assign(instance.el.style, baseStyle);

        // Helper to swap styles for hover/active
        const applyState = (stateStyle) => {
            if (stateStyle) Object.assign(instance.el.style, stateStyle);
        };

        const resetStyle = () => {
            const clearStyles = (styleObj) => {
                if (!styleObj) return;
                for (const key of Object.keys(styleObj)) {
                    instance.el.style[key] = ''; 
                }
            };
        
            clearStyles(mergedProps.active);
            clearStyles(mergedProps.hover);
        
            Object.assign(instance.el.style, baseStyle);
        
            if (!instanceStyle.transform) {
                instance.el.style.transform = instance._baseTransform || 'none';
            }
        
            if (instance._isHovered) {
                applyState(mergedProps.hover);
            }
        };

        // --- MOUSE STATES ---
        instance.el.addEventListener('mouseenter', () => { 
            instance._isHovered = true; 
            applyState(mergedProps.hover); 
        });
        instance.el.addEventListener('mouseleave', () => { 
            instance._isHovered = false; 
            resetStyle(); 
        });
        instance.el.addEventListener('mousedown', () => {
            applyState(mergedProps.active);
        });
        instance.el.addEventListener('mouseup', () => {
            resetStyle();
            if (instance._isHovered) applyState(mergedProps.hover);
        });

        // --- PROPS LOOP ---
        for (const [key, value] of Object.entries(props)) {
            if (key.startsWith("on")) {
                const eventName = key.slice(2).toLowerCase();
                // Store the specific handler
                instance[`handle_${eventName}`] = value;
            } 
            else if (key === "value") {
                instance.value = value;
            }
            else if (key === "text") {
                instance.el.innerText = value;
            }
            else if (key !== "style" && key !== "hover" && key !== "active") {
                instance.el.setAttribute(key, value);
            }
        }

        const events = ['click', 'input', 'change', 'mousedown', 'mouseup', 'mouseenter', 'mouseleave'];

        events.forEach(type => {
            instance.el.addEventListener(type, (e) => {
                if (type === 'input' || type === 'change') {
                    instance.value = (instance.el.type === 'checkbox') ? instance.el.checked : instance.el.value;
                }

                if (type === 'mouseenter') { instance._isHovered = true; applyState(mergedProps.hover); }
                if (type === 'mouseleave') { instance._isHovered = false; resetStyle(); }
                if (type === 'mousedown') { applyState(mergedProps.active); }
                if (type === 'mouseup') { resetStyle(); if (instance._isHovered) applyState(mergedProps.hover); }

                instance.onevent(type, e);
            });
        });

        // --- MOUNT CHILDREN ---
        for (const child of children) {
            instance.el.appendChild(child.el);
        }

        return instance;
    },

    panel(props, children) {
        return this._create(new Panel(), props, children);
    },

    // Shortcut for vertical layout
    col(props = {}, children = []) {
        const newProps = { ...props, style: { flexDirection: 'column', ...props.style } };
        return this.panel(newProps, children);
    },

    // Shortcut for horizontal layout
    row(props = {}, children = []) {
        const newProps = { ...props, style: { flexDirection: 'row', alignItems: 'center', ...props.style } };
        return this.panel(newProps, children);
    },

    label(props, children) {
        return this._create(new Label(), props, children);
    },

    button(props, children) {
        return this._create(new Button(), props, children);
    },

    slider(props, children) {
        return this._create(new Slider(), props, children);
    },

    checkbox(props, children) {
        return this._create(new Checkbox(), props, children);
    },

    textarea(props, children) {
        return this._create(new Textarea(), props, children);
    },

    divider(props = {}) {
        const instance = new Divider();
        
        const thickness = props.thickness || '1px';
        const margin = props.margin || '5px';

        // Check if we are inside a row or col style-wise
        const isRow = props.style?.flexDirection === 'row';

        instance.el.style.width = isRow ? thickness : 'auto';
        instance.el.style.height = isRow ? 'auto' : thickness;
        instance.el.style.margin = isRow ? `0 ${margin}` : `${margin} 0`;

        return this._create(instance, props);
    },

    el(tag, props, children) {
        const instance = new UIElement();
        instance.el = document.createElement(tag);
        instance.el.style.display = 'flex';
        instance._initEventListeners();

        return this._create(instance, props, children);
    },

    mount(instance, root = document.body) {
        root.appendChild(instance.el);
    }
};