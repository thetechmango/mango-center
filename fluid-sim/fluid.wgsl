struct Config {
    width: f32,
    height: f32,
    dt: f32,
    friction: f32,
}

@group(0) @binding(0) var<uniform> cfg: Config;
@group(0) @binding(1) var<storage, read_write> v_out: array<vec2f>;
@group(0) @binding(2) var<storage, read> v_in: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> p_out: array<f32>;
@group(0) @binding(4) var<storage, read> p_in: array<f32>;
@group(0) @binding(5) var<storage, read_write> divergence: array<f32>;
@group(0) @binding(6) var<storage, read_write> d_out: array<vec4f>;
@group(0) @binding(7) var<storage, read> d_in: array<vec4f>;

fn get_idx(x: f32, y: f32) -> u32 {
    let ix = clamp(u32(x), 0u, u32(cfg.width) - 1u);
    let iy = clamp(u32(y), 0u, u32(cfg.height) - 1u);
    return iy * u32(cfg.width) + ix;
}

// --- COMPUTE KERNELS ---

@compute @workgroup_size(16, 16)
fn advect_velocity(@builtin(global_invocation_id) id: vec3u) {
    let x = f32(id.x);
    let y = f32(id.y);
    if (x >= cfg.width || y >= cfg.height) { return; }
    
    let i = get_idx(x, y);
    var oldPos = vec2f(x, y) - cfg.dt * v_in[i];
    
    // Bilinear Interpolation
    oldPos = clamp(oldPos, vec2f(0.5), vec2f(cfg.width - 1.5, cfg.height - 1.5));
    let i0j0 = vec2u(floor(oldPos));
    let i1j1 = i0j0 + 1u;
    let f = fract(oldPos);

    let tl = v_in[i0j0.y * u32(cfg.width) + i0j0.x];
    let tr = v_in[i0j0.y * u32(cfg.width) + i1j1.x];
    let bl = v_in[i1j1.y * u32(cfg.width) + i0j0.x];
    let br = v_in[i1j1.y * u32(cfg.width) + i1j1.x];

    v_out[i] = mix(mix(tl, tr, f.x), mix(bl, br, f.x), f.y) * cfg.friction;
}

@compute @workgroup_size(16, 16)
fn advect_density(@builtin(global_invocation_id) id: vec3u) {
    let x = f32(id.x);
    let y = f32(id.y);
    if (x >= cfg.width || y >= cfg.height) { return; }
    
    let i = get_idx(x, y);
    var oldPos = vec2f(x, y) - cfg.dt * v_in[i]; // Use velocity to move dye
    
    oldPos = clamp(oldPos, vec2f(0.5), vec2f(cfg.width - 1.5, cfg.height - 1.5));
    let i0j0 = vec2u(floor(oldPos));
    let i1j1 = i0j0 + 1u;
    let f = fract(oldPos);

    let tl = d_in[i0j0.y * u32(cfg.width) + i0j0.x];
    let tr = d_in[i0j0.y * u32(cfg.width) + i1j1.x];
    let bl = d_in[i1j1.y * u32(cfg.width) + i0j0.x];
    let br = d_in[i1j1.y * u32(cfg.width) + i1j1.x];

    d_out[i] = mix(mix(tl, tr, f.x), mix(bl, br, f.x), f.y) * cfg.friction;
}

@compute @workgroup_size(16, 16)
fn project_divergence(@builtin(global_invocation_id) id: vec3u) {
    let x = id.x;
    let y = id.y;
    if (x < 1u || x >= u32(cfg.width)-1u || y < 1u || y >= u32(cfg.height)-1u) { return; }

    let i = get_idx(f32(x), f32(y));
    let vL = v_in[i - 1u].x;
    let vR = v_in[i + 1u].x;
    let vT = v_in[i - u32(cfg.width)].y;
    let vB = v_in[i + u32(cfg.width)].y;

    divergence[i] = -0.5 * (vR - vL + vB - vT);
}

@compute @workgroup_size(16, 16)
fn project_solve_pressure(@builtin(global_invocation_id) id: vec3u) {
    let x = id.x;
    let y = id.y;
    if (x < 1u || x >= u32(cfg.width)-1u || y < 1u || y >= u32(cfg.height)-1u) { return; }

    let i = get_idx(f32(x), f32(y));
    p_out[i] = (divergence[i] + p_in[i-1u] + p_in[i+1u] + p_in[i-u32(cfg.width)] + p_in[i+u32(cfg.width)]) / 4.0;
}

@compute @workgroup_size(16, 16)
fn project_apply_gradient(@builtin(global_invocation_id) id: vec3u) {
    let x = id.x;
    let y = id.y;
    if (x < 1u || x >= u32(cfg.width)-1u || y < 1u || y >= u32(cfg.height)-1u) { return; }

    let i = get_idx(f32(x), f32(y));
    let pL = p_in[i - 1u];
    let pR = p_in[i + 1u];
    let pT = p_in[i - u32(cfg.width)];
    let pB = p_in[i + u32(cfg.width)];

    v_out[i] = v_in[i] - 0.5 * vec2f(pR - pL, pB - pT);
}

// --- RENDER SHADERS ---

struct VertexOutput {
    @builtin(position) pos: vec4f,
    @location(0) uv: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VertexOutput {
    var out: VertexOutput;
    let x = f32((i32(idx) << 1u) & 2) - 1.0;
    let y = f32(i32(idx) & 2) - 1.0;
    out.pos = vec4f(x, y, 0.0, 1.0);
    out.uv = vec2f(x * 0.5 + 0.5, 1.0 - (y * 0.5 + 0.5));
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    let i = get_idx(in.uv.x * cfg.width, in.uv.y * cfg.height);
    let color = d_in[i];
    return vec4f(color, 1.0);
}
