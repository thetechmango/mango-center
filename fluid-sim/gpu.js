async function init() {
    if (!navigator.gpu) throw new Error("WebGPU not supported.");

    const width = 256;
    const height = 256;

    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();

    const canvas = document.getElementById('canvas');
    const context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'premultiplied' });

    const shaderSource = await fetch('./fluid.wgsl').then(r => r.text());
    const shaderModule = device.createShaderModule({ code: shaderSource });

    const numPixels = width * height;

    // --- 1. EXPLICIT BIND GROUP LAYOUT ---
    // This defines the "shape" of the data for ALL pipelines
    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },          // v_out
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // v_in
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },          // p_out
            { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // p_in
            { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },          // div
            { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },          // d_out
            { binding: 7, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } } // d_in
        ]
    });

    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

    // --- 2. BUFFERS ---
    const createBuffer = (size, label) => device.createBuffer({
        label, size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });

    const vA = createBuffer(numPixels * 8, 'vA');   const vB = createBuffer(numPixels * 8, 'vB');
    const dA = createBuffer(numPixels * 16, 'dA');  const dB = createBuffer(numPixels * 16, 'dB');
    const pA = createBuffer(numPixels * 4, 'pA');   const pB = createBuffer(numPixels * 4, 'pB');
    const div = createBuffer(numPixels * 4, 'div');
    const uniformBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([width, height, 1.0, 0.99]));

    // --- 3. PIPELINES ---
    const createCompute = (entry) => device.createComputePipeline({
        layout: pipelineLayout, // Use manual layout
        compute: { module: shaderModule, entryPoint: entry }
    });

    const pipeAdvectVel = createCompute('advect_velocity');
    const pipeDiv = createCompute('project_divergence');
    const pipePressure = createCompute('project_solve_pressure');
    const pipeGrad = createCompute('project_apply_gradient');

    const renderPipeline = device.createRenderPipeline({
        layout: pipelineLayout, // Use manual layout
        vertex: { module: shaderModule, entryPoint: 'vs_main' },
        fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format }] }
    });

    // --- 4. BIND GROUPS (PING-PONG) ---
    const entriesA = [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: vB } }, { binding: 2, resource: { buffer: vA } },
        { binding: 3, resource: { buffer: pB } }, { binding: 4, resource: { buffer: pA } },
        { binding: 5, resource: { buffer: div } },
        { binding: 6, resource: { buffer: dB } }, { binding: 7, resource: { buffer: dA } }
    ];
    const bindA = device.createBindGroup({ layout: bindGroupLayout, entries: entriesA });

    const entriesB = [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: vA } }, { binding: 2, resource: { buffer: vB } },
        { binding: 3, resource: { buffer: pA } }, { binding: 4, resource: { buffer: pB } },
        { binding: 5, resource: { buffer: div } },
        { binding: 6, resource: { buffer: dA } }, { binding: 7, resource: { buffer: dB } }
    ];
    const bindB = device.createBindGroup({ layout: bindGroupLayout, entries: entriesB });

    // --- 5. INTERACTION ---
    let lastMouse = { x: 0, y: 0 };
    canvas.addEventListener('mousemove', (e) => {
        if (e.buttons === 1) {
            const rect = canvas.getBoundingClientRect();
            const x = Math.floor(((e.clientX - rect.left) / rect.width) * width);
            const y = Math.floor(((e.clientY - rect.top) / rect.height) * height);
            const dx = (x - lastMouse.x) * 0.1;
            const dy = (y - lastMouse.y) * 0.1;

            // Upload force and color to current input buffer (A)
            const offsetV = (y * width + x) * 8;
            const offsetD = (y * width + x) * 16;
            device.queue.writeBuffer(vA, offsetV, new Float32Array([dx, dy]));
            device.queue.writeBuffer(dA, offsetD, new Float32Array([1.0, 1.0, 1.0, 1.0]));
        }
        lastMouse = { x: e.clientX, y: e.clientY };
    });

    let frameCount = 0;
    function frame() {
        const isEven = frameCount % 2 === 0;
        const currentBind = isEven ? bindA : bindB;
        const encoder = device.createCommandEncoder();
        
        const compute = encoder.beginComputePass();
        compute.setBindGroup(0, currentBind);

        compute.setPipeline(pipeAdvectVel);
        compute.dispatchWorkgroups(width / 16, height / 16);

        compute.setPipeline(pipeDiv);
        compute.dispatchWorkgroups(width / 16, height / 16);

        compute.setPipeline(pipePressure);
        for(let i = 0; i < 20; i++) {
            compute.dispatchWorkgroups(width / 16, height / 16);
        }

        compute.setPipeline(pipeGrad);
        compute.dispatchWorkgroups(width / 16, height / 16);
        compute.end();

        const render = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 }
            }]
        });
        render.setPipeline(renderPipeline);
        render.setBindGroup(0, currentBind);
        render.draw(3); 
        render.end();

        device.queue.submit([encoder.finish()]);
        frameCount++;
        requestAnimationFrame(frame);
    }
    frame();
}

init();