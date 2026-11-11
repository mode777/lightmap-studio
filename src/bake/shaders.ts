export const BAKE_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_view;
uniform mat4 u_projection;

out vec2 v_uv;

void main() {
  v_uv = a_uv;
  gl_Position = u_projection * (u_view * vec4(a_position, 1.0));
}
`;

export const BAKE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_lightmap;
uniform vec3 u_color;
uniform int u_mode;

out vec4 o_color;

void main() {
  vec3 color = u_mode == 0
    ? texture(u_lightmap, v_uv).rgb * u_color
    : u_color;
  o_color = vec4(color, gl_FrontFacing ? 1.0 : 0.0);
}
`;

export const ENVIRONMENT_VERTEX_SHADER = `#version 300 es
precision highp float;

uniform vec3 u_ray[3];

out vec3 v_ray;

void main() {
  const vec2 positions[3] = vec2[3](
    vec2(-1.0, -1.0),
    vec2(3.0, -1.0),
    vec2(-1.0, 3.0)
  );
  v_ray = u_ray[gl_VertexID];
  gl_Position = vec4(positions[gl_VertexID], 1.0, 1.0);
}
`;

export const ENVIRONMENT_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 v_ray;

uniform sampler2D u_environment;
uniform float u_intensity;

out vec4 o_color;

const float PI = 3.141592653589793;

void main() {
  vec3 direction = normalize(v_ray);
  float u = atan(direction.z, direction.x) / (2.0 * PI) + 0.5;
  float v = asin(clamp(direction.y, -1.0, 1.0)) / PI + 0.5;
  vec3 radiance = texture(u_environment, vec2(u, v)).rgb * u_intensity;
  o_color = vec4(radiance, 1.0);
}
`;
