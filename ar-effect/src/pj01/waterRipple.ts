const MAX_RIPPLES = 32

const VERTEX_SHADER = `
attribute vec2 aPosition;

varying vec2 vUv;

void main() {

  vUv = aPosition * 0.5 + 0.5;

  gl_Position =
    vec4(
      aPosition,
      0.0,
      1.0
    );
}
`

const FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUv;

uniform sampler2D uCamera;

uniform vec4 uRipples[${MAX_RIPPLES}];

uniform float uTime;

uniform float uWaveSpeed;
uniform float uRingWidth;
uniform float uDecay;
uniform float uFrequency;
uniform float uTemporalFrequency;
uniform float uMaxAge;

uniform vec2 uScreenResolution;
uniform vec2 uVideoResolution;


// ==========================================
// CAMERA UV
// ==========================================

vec2 cameraUV(
  vec2 screenUV
) {

  float screenAspect =
    uScreenResolution.x /
    uScreenResolution.y;

  float videoAspect =
    uVideoResolution.x /
    uVideoResolution.y;

  vec2 uv =
    screenUV;

  /*
   * object-fit: cover
   *
   * We scale the smaller dimension
   * until the entire screen is covered.
   */

  if (
    screenAspect > videoAspect
  ) {

    /*
     * Screen is wider than video.
     *
     * Crop top/bottom.
     */

    float scale =
      videoAspect /
      screenAspect;

    uv.y =
      (uv.y - 0.5) *
      scale +
      0.5;

  } else {

    /*
     * Screen is taller than video.
     *
     * Crop left/right.
     */

    float scale =
      screenAspect /
      videoAspect;

    uv.x =
      (uv.x - 0.5) *
      scale +
      0.5;
  }

  /*
   * Selfie camera.
   */

  uv.x =
    1.0 - uv.x;

  return uv;
}


// ==========================================
// RIPPLE
// ==========================================

float rippleHeight(
  vec2 uv
) {

  float height = 0.0;

  float screenAspect =
    uScreenResolution.x /
    uScreenResolution.y;

  for (
    int i = 0;
    i < ${MAX_RIPPLES};
    i++
  ) {

    vec4 ripple =
      uRipples[i];

    float age =
      uTime - ripple.z;

    if (
      ripple.w <= 0.0 ||
      age < 0.0 ||
      age > uMaxAge
    ) {
      continue;
    }

    /*
     * Correct the ripple shape for
     * screen aspect ratio.
     */

    vec2 difference =
      (uv - ripple.xy);

    difference.x *=
      screenAspect;

    float distance =
      length(difference);

    float radius =
      age * uWaveSpeed;

    float ring =
      exp(
        -pow(
          (
            distance -
            radius
          ) /
          uRingWidth,
          2.0
        )
      );

    float fade =
      exp(
        -age *
        uDecay
      );

    float wave =
      sin(
        distance *
        uFrequency -
        age *
        uTemporalFrequency
      );

    height +=
      wave *
      ring *
      fade *
      ripple.w;
  }

  return height;
}


// ==========================================
// MAIN
// ==========================================

void main() {

  vec2 uv =
    cameraUV(vUv);

  // ----------------------------------------
  // Ripple gradient
  // ----------------------------------------

  vec2 e =
    vec2(
      0.0025,
      0.0
    );

  float left =
    rippleHeight(
      vUv - e
    );

  float right =
    rippleHeight(
      vUv + e
    );

  float top =
    rippleHeight(
      vUv + e.yx
    );

  float bottom =
    rippleHeight(
      vUv - e.yx
    );

  vec2 gradient =
    vec2(
      right - left,
      top - bottom
    );

  // ----------------------------------------
  // Distort camera
  // ----------------------------------------

  uv +=
    gradient * 0.055;

  // ----------------------------------------
  // Camera
  // ----------------------------------------

  vec3 color =
    texture2D(
      uCamera,
      uv
    ).rgb;

  // ----------------------------------------
  // Water highlight
  // ----------------------------------------

  vec3 normal =
    normalize(
      vec3(
        -gradient * 7.0,
        1.0
      )
    );

  vec3 lightDirection =
    normalize(
      vec3(
        -0.3,
        0.5,
        0.8
      )
    );

  float highlight =
    pow(
      max(
        dot(
          normal,
          lightDirection
        ),
        0.0
      ),
      32.0
    );

  color +=
    highlight *
    0.18;

  gl_FragColor =
    vec4(
      color,
      1.0
    );
}
`

type Ripple = {
  x: number
  y: number
  time: number
  strength: number
}

export class WaterRipple {

  private canvas: HTMLCanvasElement
  private gl: WebGLRenderingContext

  private program: WebGLProgram

  private positionBuffer: WebGLBuffer
  private cameraTexture: WebGLTexture

  private ripples: Ripple[] = []

  private rippleIndex = 0

  private animationFrame = 0

  private startTime =
    performance.now()

  private width = 0
  private height = 0

  private video: HTMLVideoElement

  constructor(
    canvas: HTMLCanvasElement,
    video: HTMLVideoElement
  ) {

    this.canvas =
      canvas

    this.video =
      video

    const gl =
      canvas.getContext(
        'webgl',
        {
          antialias: true,
          alpha: false,
        }
      )

    if (!gl) {
      throw new Error(
        'WebGL is not supported'
      )
    }

    this.gl =
      gl

    this.program =
      this.createProgram(
        VERTEX_SHADER,
        FRAGMENT_SHADER
      )

    this.positionBuffer =
      gl.createBuffer()!

    this.cameraTexture =
      gl.createTexture()!

    this.setupGeometry()

    this.setupCameraTexture()

    this.resize()

    window.addEventListener(
      'resize',
      this.resize
    )

    this.animate()
  }

  // ==========================================
  // SHADERS
  // ==========================================

  private createShader(
    type: number,
    source: string
  ) {

    const shader =
      this.gl.createShader(
        type
      )!

    this.gl.shaderSource(
      shader,
      source
    )

    this.gl.compileShader(
      shader
    )

    if (
      !this.gl.getShaderParameter(
        shader,
        this.gl.COMPILE_STATUS
      )
    ) {

      throw new Error(
        this.gl.getShaderInfoLog(
          shader
        ) ||
        'Shader compilation error'
      )
    }

    return shader
  }

  private createProgram(
    vertexSource: string,
    fragmentSource: string
  ) {

    const vertex =
      this.createShader(
        this.gl.VERTEX_SHADER,
        vertexSource
      )

    const fragment =
      this.createShader(
        this.gl.FRAGMENT_SHADER,
        fragmentSource
      )

    const program =
      this.gl.createProgram()!

    this.gl.attachShader(
      program,
      vertex
    )

    this.gl.attachShader(
      program,
      fragment
    )

    this.gl.linkProgram(
      program
    )

    if (
      !this.gl.getProgramParameter(
        program,
        this.gl.LINK_STATUS
      )
    ) {

      throw new Error(
        this.gl.getProgramInfoLog(
          program
        ) ||
        'Program link error'
      )
    }

    return program
  }

  // ==========================================
  // GEOMETRY
  // ==========================================

  private setupGeometry() {

    const gl =
      this.gl

    gl.bindBuffer(
      gl.ARRAY_BUFFER,
      this.positionBuffer
    )

    gl.bufferData(
      gl.ARRAY_BUFFER,

      new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
         1,  1,
      ]),

      gl.STATIC_DRAW
    )
  }

  // ==========================================
  // CAMERA TEXTURE
  // ==========================================

  private setupCameraTexture() {

    const gl =
      this.gl

    gl.bindTexture(
      gl.TEXTURE_2D,
      this.cameraTexture
    )

    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_WRAP_S,
      gl.CLAMP_TO_EDGE
    )

    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_WRAP_T,
      gl.CLAMP_TO_EDGE
    )

    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR
    )

    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MAG_FILTER,
      gl.LINEAR
    )

    gl.pixelStorei(
      gl.UNPACK_FLIP_Y_WEBGL,
      true
    )
  }

  // ==========================================
  // RESIZE
  // ==========================================

  private resize = () => {

    this.width =
      window.innerWidth

    this.height =
      window.innerHeight

    const dpr =
      Math.min(
        window.devicePixelRatio || 1,
        2
      )

    this.canvas.width =
      this.width * dpr

    this.canvas.height =
      this.height * dpr

    this.canvas.style.width =
      `${this.width}px`

    this.canvas.style.height =
      `${this.height}px`

    this.gl.viewport(
      0,
      0,
      this.canvas.width,
      this.canvas.height
    )
  }

  // ==========================================
  // RIPPLE
  // ==========================================

  addRipple(
    x: number,
    y: number,
    strength = 1
  ) {

    this.ripples[
      this.rippleIndex
    ] = {

      x,
      y,

      time:
        this.getTime(),

      strength,
    }

    this.rippleIndex =
      (
        this.rippleIndex + 1
      ) %
      MAX_RIPPLES
  }

  // ==========================================
  // TIME
  // ==========================================

  private getTime() {

    return (
      performance.now() -
      this.startTime
    ) / 1000
  }

  // ==========================================
  // RENDER
  // ==========================================

  private animate = () => {

    const gl =
      this.gl

    const time =
      this.getTime()

    // ----------------------------------------
    // Clear
    // ----------------------------------------

    gl.clearColor(
      0,
      0,
      0,
      1
    )

    gl.clear(
      gl.COLOR_BUFFER_BIT
    )

    // ----------------------------------------
    // Update camera texture
    // ----------------------------------------

    if (
      this.video.readyState >= 2 &&
      this.video.videoWidth > 0
    ) {

      gl.bindTexture(
        gl.TEXTURE_2D,
        this.cameraTexture
      )

      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.video
      )
    }

    // ----------------------------------------
    // Program
    // ----------------------------------------

    gl.useProgram(
      this.program
    )

    // ----------------------------------------
    // Geometry
    // ----------------------------------------

    gl.bindBuffer(
      gl.ARRAY_BUFFER,
      this.positionBuffer
    )

    const position =
      gl.getAttribLocation(
        this.program,
        'aPosition'
      )

    gl.enableVertexAttribArray(
      position
    )

    gl.vertexAttribPointer(
      position,
      2,
      gl.FLOAT,
      false,
      0,
      0
    )

    // ----------------------------------------
    // Camera texture
    // ----------------------------------------

    gl.activeTexture(
      gl.TEXTURE0
    )

    gl.bindTexture(
      gl.TEXTURE_2D,
      this.cameraTexture
    )

    gl.uniform1i(
      gl.getUniformLocation(
        this.program,
        'uCamera'
      ),
      0
    )

    // ----------------------------------------
    // Ripples
    // ----------------------------------------

    const rippleData =
      new Float32Array(
        MAX_RIPPLES * 4
      )

    for (
      let i = 0;
      i < MAX_RIPPLES;
      i++
    ) {

      const ripple =
        this.ripples[i]

      if (!ripple) {
        continue
      }

      const offset =
        i * 4

      rippleData[offset] =
        ripple.x

      rippleData[offset + 1] =
        ripple.y

      rippleData[offset + 2] =
        ripple.time

      rippleData[offset + 3] =
        ripple.strength
    }

    gl.uniform4fv(
      gl.getUniformLocation(
        this.program,
        'uRipples'
      ),
      rippleData
    )

    // ----------------------------------------
    // Parameters
    // ----------------------------------------

    gl.uniform1f(
      gl.getUniformLocation(
        this.program,
        'uTime'
      ),
      time
    )

    gl.uniform1f(
      gl.getUniformLocation(
        this.program,
        'uWaveSpeed'
      ),
      0.42
    )

    gl.uniform1f(
      gl.getUniformLocation(
        this.program,
        'uRingWidth'
      ),
      0.035
    )

    gl.uniform1f(
      gl.getUniformLocation(
        this.program,
        'uDecay'
      ),
      0.85
    )

    gl.uniform1f(
      gl.getUniformLocation(
        this.program,
        'uFrequency'
      ),
      60
    )

    gl.uniform1f(
      gl.getUniformLocation(
        this.program,
        'uTemporalFrequency'
      ),
      9
    )

    gl.uniform1f(
      gl.getUniformLocation(
        this.program,
        'uMaxAge'
      ),
      2.8
    )

    gl.uniform2f(
      gl.getUniformLocation(
        this.program,
        'uScreenResolution'
      ),
      this.width,
      this.height
    )

    gl.uniform2f(
      gl.getUniformLocation(
        this.program,
        'uVideoResolution'
      ),
      this.video.videoWidth || 1280,
      this.video.videoHeight || 720
    )

    // ----------------------------------------
    // DRAW
    // ----------------------------------------

    gl.drawArrays(
      gl.TRIANGLE_STRIP,
      0,
      4
    )

    this.animationFrame =
      requestAnimationFrame(
        this.animate
      )
  }

  // ==========================================
  // CLEANUP
  // ==========================================

  destroy() {

    cancelAnimationFrame(
      this.animationFrame
    )

    window.removeEventListener(
      'resize',
      this.resize
    )

    this.gl.deleteTexture(
      this.cameraTexture
    )

    this.gl.deleteProgram(
      this.program
    )

    this.gl.deleteBuffer(
      this.positionBuffer
    )
  }
}