(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  if (reducedMotion.matches) return;

  const config = {
    simResolution: 128,
    dyeResolution: 1440,
    densityDissipation: 3,
    velocityDissipation: 4,
    pressure: 0.15,
    pressureIterations: 20,
    curl: 3,
    splatRadius: 0.2,
    splatForce: 4500,
    shading: true,
    colorUpdateSpeed: 9,
    rainbowMode: false,
    transparent: true,
    color: "#9AA3C7",
  };

  const layer = document.createElement("div");
  const canvas = document.createElement("canvas");
  layer.className = "splash-cursor";
  layer.setAttribute("aria-hidden", "true");
  canvas.id = "fluid";
  layer.appendChild(canvas);
  document.body.appendChild(layer);

  const contextAttributes = {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    preserveDrawingBuffer: false,
  };
  const gl =
    canvas.getContext("webgl2", contextAttributes) ||
    canvas.getContext("webgl", contextAttributes) ||
    canvas.getContext("experimental-webgl", contextAttributes);

  if (!gl) {
    layer.remove();
    return;
  }

  const isWebGL2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
  let halfFloat;
  let supportLinearFiltering;

  if (isWebGL2) {
    gl.getExtension("EXT_color_buffer_float");
    supportLinearFiltering = gl.getExtension("OES_texture_float_linear");
  } else {
    halfFloat = gl.getExtension("OES_texture_half_float");
    supportLinearFiltering = gl.getExtension("OES_texture_half_float_linear");
  }

  const halfFloatType = isWebGL2 ? gl.HALF_FLOAT : halfFloat?.HALF_FLOAT_OES;

  if (!halfFloatType) {
    layer.remove();
    return;
  }

  function supportsRenderTextureFormat(internalFormat, format, type) {
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const supported = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.deleteTexture(texture);
    gl.deleteFramebuffer(framebuffer);
    return supported;
  }

  function getSupportedFormat(internalFormat, format, type) {
    if (supportsRenderTextureFormat(internalFormat, format, type)) {
      return { internalFormat, format };
    }

    if (isWebGL2 && internalFormat === gl.R16F) {
      return getSupportedFormat(gl.RG16F, gl.RG, type);
    }

    if (isWebGL2 && internalFormat === gl.RG16F) {
      return getSupportedFormat(gl.RGBA16F, gl.RGBA, type);
    }

    return null;
  }

  const formats = {
    rgba: getSupportedFormat(isWebGL2 ? gl.RGBA16F : gl.RGBA, gl.RGBA, halfFloatType),
    rg: getSupportedFormat(isWebGL2 ? gl.RG16F : gl.RGBA, isWebGL2 ? gl.RG : gl.RGBA, halfFloatType),
    r: getSupportedFormat(isWebGL2 ? gl.R16F : gl.RGBA, isWebGL2 ? gl.RED : gl.RGBA, halfFloatType),
  };

  if (!formats.rgba || !formats.rg || !formats.r) {
    layer.remove();
    return;
  }

  if (!supportLinearFiltering) {
    config.dyeResolution = 256;
    config.shading = false;
  }

  function addKeywords(source, keywords = []) {
    return `${keywords.map((keyword) => `#define ${keyword}`).join("\n")}\n${source}`;
  }

  function compileShader(type, source, keywords) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, addKeywords(source, keywords));
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
    }

    return shader;
  }

  function createProgram(vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
    }

    return program;
  }

  function getUniforms(program) {
    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);

    for (let index = 0; index < count; index += 1) {
      const name = gl.getActiveUniform(program, index).name;
      uniforms[name] = gl.getUniformLocation(program, name);
    }

    return uniforms;
  }

  class Program {
    constructor(vertexShader, fragmentShader) {
      this.program = createProgram(vertexShader, fragmentShader);
      this.uniforms = getUniforms(this.program);
    }

    bind() {
      gl.useProgram(this.program);
    }
  }

  class Material {
    constructor(vertexShader, fragmentSource) {
      this.vertexShader = vertexShader;
      this.fragmentSource = fragmentSource;
      this.programs = new Map();
      this.activeProgram = null;
      this.uniforms = {};
    }

    setKeywords(keywords) {
      const key = keywords.join("|");

      if (!this.programs.has(key)) {
        const fragmentShader = compileShader(gl.FRAGMENT_SHADER, this.fragmentSource, keywords);
        this.programs.set(key, createProgram(this.vertexShader, fragmentShader));
      }

      const program = this.programs.get(key);
      if (program === this.activeProgram) return;
      this.activeProgram = program;
      this.uniforms = getUniforms(program);
    }

    bind() {
      gl.useProgram(this.activeProgram);
    }
  }

  const baseVertexShader = compileShader(
    gl.VERTEX_SHADER,
    `
      precision highp float;
      attribute vec2 aPosition;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform vec2 texelSize;

      void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `
  );

  const copyShader = compileShader(
    gl.FRAGMENT_SHADER,
    `
      precision mediump float;
      varying highp vec2 vUv;
      uniform sampler2D uTexture;
      void main () { gl_FragColor = texture2D(uTexture, vUv); }
    `
  );

  const clearShader = compileShader(
    gl.FRAGMENT_SHADER,
    `
      precision mediump float;
      varying highp vec2 vUv;
      uniform sampler2D uTexture;
      uniform float value;
      void main () { gl_FragColor = value * texture2D(uTexture, vUv); }
    `
  );

  const displayShaderSource = `
    precision highp float;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform vec2 texelSize;

    void main () {
      vec3 color = texture2D(uTexture, vUv).rgb;
      #ifdef SHADING
        vec3 left = texture2D(uTexture, vL).rgb;
        vec3 right = texture2D(uTexture, vR).rgb;
        vec3 top = texture2D(uTexture, vT).rgb;
        vec3 bottom = texture2D(uTexture, vB).rgb;
        float dx = length(right) - length(left);
        float dy = length(top) - length(bottom);
        vec3 normal = normalize(vec3(dx, dy, length(texelSize)));
        float diffuse = clamp(dot(normal, vec3(0.0, 0.0, 1.0)) + 0.7, 0.7, 1.0);
        color *= diffuse;
      #endif
      float alpha = max(color.r, max(color.g, color.b));
      gl_FragColor = vec4(color, alpha);
    }
  `;

  const splatShader = compileShader(
    gl.FRAGMENT_SHADER,
    `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTarget;
      uniform float aspectRatio;
      uniform vec3 color;
      uniform vec2 point;
      uniform float radius;

      void main () {
        vec2 offset = vUv - point.xy;
        offset.x *= aspectRatio;
        vec3 splat = exp(-dot(offset, offset) / radius) * color;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
      }
    `
  );

  const advectionShader = compileShader(
    gl.FRAGMENT_SHADER,
    `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uSource;
      uniform vec2 texelSize;
      uniform vec2 dyeTexelSize;
      uniform float dt;
      uniform float dissipation;

      vec4 bilerp (sampler2D sampler, vec2 uv, vec2 textureSize) {
        vec2 position = uv / textureSize - 0.5;
        vec2 index = floor(position);
        vec2 fraction = fract(position);
        vec4 a = texture2D(sampler, (index + vec2(0.5, 0.5)) * textureSize);
        vec4 b = texture2D(sampler, (index + vec2(1.5, 0.5)) * textureSize);
        vec4 c = texture2D(sampler, (index + vec2(0.5, 1.5)) * textureSize);
        vec4 d = texture2D(sampler, (index + vec2(1.5, 1.5)) * textureSize);
        return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
      }

      void main () {
        #ifdef MANUAL_FILTERING
          vec2 coordinate = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
          vec4 result = bilerp(uSource, coordinate, dyeTexelSize);
        #else
          vec2 coordinate = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
          vec4 result = texture2D(uSource, coordinate);
        #endif
        gl_FragColor = result / (1.0 + dissipation * dt);
      }
    `,
    supportLinearFiltering ? [] : ["MANUAL_FILTERING"]
  );

  const divergenceShader = compileShader(
    gl.FRAGMENT_SHADER,
    `
      precision mediump float;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uVelocity;

      void main () {
        float left = texture2D(uVelocity, vL).x;
        float right = texture2D(uVelocity, vR).x;
        float top = texture2D(uVelocity, vT).y;
        float bottom = texture2D(uVelocity, vB).y;
        vec2 center = texture2D(uVelocity, vUv).xy;
        if (vL.x < 0.0) left = -center.x;
        if (vR.x > 1.0) right = -center.x;
        if (vT.y > 1.0) top = -center.y;
        if (vB.y < 0.0) bottom = -center.y;
        gl_FragColor = vec4(0.5 * (right - left + top - bottom), 0.0, 0.0, 1.0);
      }
    `
  );

  const curlShader = compileShader(
    gl.FRAGMENT_SHADER,
    `
      precision mediump float;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uVelocity;
      void main () {
        float left = texture2D(uVelocity, vL).y;
        float right = texture2D(uVelocity, vR).y;
        float top = texture2D(uVelocity, vT).x;
        float bottom = texture2D(uVelocity, vB).x;
        gl_FragColor = vec4(0.5 * (right - left - top + bottom), 0.0, 0.0, 1.0);
      }
    `
  );

  const vorticityShader = compileShader(
    gl.FRAGMENT_SHADER,
    `
      precision highp float;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uVelocity;
      uniform sampler2D uCurl;
      uniform float curl;
      uniform float dt;

      void main () {
        float left = texture2D(uCurl, vL).x;
        float right = texture2D(uCurl, vR).x;
        float top = texture2D(uCurl, vT).x;
        float bottom = texture2D(uCurl, vB).x;
        float center = texture2D(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(top) - abs(bottom), abs(right) - abs(left));
        force /= length(force) + 0.0001;
        force *= curl * center;
        force.y *= -1.0;
        vec2 velocity = texture2D(uVelocity, vUv).xy + force * dt;
        velocity = clamp(velocity, -1000.0, 1000.0);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `
  );

  const pressureShader = compileShader(
    gl.FRAGMENT_SHADER,
    `
      precision mediump float;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uDivergence;
      varying highp vec2 vUv;

      void main () {
        float pressure = (
          texture2D(uPressure, vL).x + texture2D(uPressure, vR).x +
          texture2D(uPressure, vB).x + texture2D(uPressure, vT).x -
          texture2D(uDivergence, vUv).x
        ) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
      }
    `
  );

  const gradientSubtractShader = compileShader(
    gl.FRAGMENT_SHADER,
    `
      precision mediump float;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;

      void main () {
        float left = texture2D(uPressure, vL).x;
        float right = texture2D(uPressure, vR).x;
        float top = texture2D(uPressure, vT).x;
        float bottom = texture2D(uPressure, vB).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(right - left, top - bottom);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `
  );

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  function blit(target, clear = false) {
    if (target) {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    } else {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    if (clear) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  const copyProgram = new Program(baseVertexShader, copyShader);
  const clearProgram = new Program(baseVertexShader, clearShader);
  const splatProgram = new Program(baseVertexShader, splatShader);
  const advectionProgram = new Program(baseVertexShader, advectionShader);
  const divergenceProgram = new Program(baseVertexShader, divergenceShader);
  const curlProgram = new Program(baseVertexShader, curlShader);
  const vorticityProgram = new Program(baseVertexShader, vorticityShader);
  const pressureProgram = new Program(baseVertexShader, pressureShader);
  const gradientSubtractProgram = new Program(baseVertexShader, gradientSubtractShader);
  const displayMaterial = new Material(baseVertexShader, displayShaderSource);
  displayMaterial.setKeywords(config.shading ? ["SHADING"] : []);

  function createFramebuffer(width, height, format, type, filtering) {
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filtering);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filtering);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, format.internalFormat, width, height, 0, format.format, type, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return {
      texture,
      framebuffer,
      width,
      height,
      texelSizeX: 1 / width,
      texelSizeY: 1 / height,
      attach(id) {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      },
    };
  }

  function createDoubleFramebuffer(width, height, format, type, filtering) {
    let read = createFramebuffer(width, height, format, type, filtering);
    let write = createFramebuffer(width, height, format, type, filtering);

    return {
      width,
      height,
      texelSizeX: read.texelSizeX,
      texelSizeY: read.texelSizeY,
      get read() { return read; },
      set read(value) { read = value; },
      get write() { return write; },
      set write(value) { write = value; },
      swap() { [read, write] = [write, read]; },
    };
  }

  function getResolution(resolution) {
    let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspectRatio < 1) aspectRatio = 1 / aspectRatio;
    const minimum = Math.round(resolution);
    const maximum = Math.round(resolution * aspectRatio);
    return gl.drawingBufferWidth > gl.drawingBufferHeight
      ? { width: maximum, height: minimum }
      : { width: minimum, height: maximum };
  }

  function resizeSingleFramebuffer(target, width, height, format, type, filtering) {
    const resized = createFramebuffer(width, height, format, type, filtering);
    copyProgram.bind();
    gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0));
    blit(resized);
    return resized;
  }

  function resizeDoubleFramebuffer(target, width, height, format, type, filtering) {
    if (target.width === width && target.height === height) return target;
    target.read = resizeSingleFramebuffer(target.read, width, height, format, type, filtering);
    target.write = createFramebuffer(width, height, format, type, filtering);
    target.width = width;
    target.height = height;
    target.texelSizeX = 1 / width;
    target.texelSizeY = 1 / height;
    return target;
  }

  let dye;
  let velocity;
  let divergence;
  let curl;
  let pressure;

  function initializeFramebuffers() {
    const simulationSize = getResolution(config.simResolution);
    const dyeSize = getResolution(config.dyeResolution);
    const filtering = supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
    gl.disable(gl.BLEND);

    dye = dye
      ? resizeDoubleFramebuffer(dye, dyeSize.width, dyeSize.height, formats.rgba, halfFloatType, filtering)
      : createDoubleFramebuffer(dyeSize.width, dyeSize.height, formats.rgba, halfFloatType, filtering);
    velocity = velocity
      ? resizeDoubleFramebuffer(velocity, simulationSize.width, simulationSize.height, formats.rg, halfFloatType, filtering)
      : createDoubleFramebuffer(simulationSize.width, simulationSize.height, formats.rg, halfFloatType, filtering);
    divergence = createFramebuffer(simulationSize.width, simulationSize.height, formats.r, halfFloatType, gl.NEAREST);
    curl = createFramebuffer(simulationSize.width, simulationSize.height, formats.r, halfFloatType, gl.NEAREST);
    pressure = createDoubleFramebuffer(simulationSize.width, simulationSize.height, formats.r, halfFloatType, gl.NEAREST);
  }

  function resizeCanvas() {
    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.floor(canvas.clientWidth * pixelRatio);
    const height = Math.floor(canvas.clientHeight * pixelRatio);

    if (canvas.width === width && canvas.height === height) return false;
    canvas.width = width;
    canvas.height = height;
    return true;
  }

  function step(deltaTime) {
    gl.disable(gl.BLEND);

    curlProgram.bind();
    gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(curl);

    vorticityProgram.bind();
    gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1));
    gl.uniform1f(vorticityProgram.uniforms.curl, config.curl);
    gl.uniform1f(vorticityProgram.uniforms.dt, deltaTime);
    blit(velocity.write);
    velocity.swap();

    divergenceProgram.bind();
    gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence);

    clearProgram.bind();
    gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(clearProgram.uniforms.value, config.pressure);
    blit(pressure.write);
    pressure.swap();

    pressureProgram.bind();
    gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));

    for (let index = 0; index < config.pressureIterations; index += 1) {
      gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
      blit(pressure.write);
      pressure.swap();
    }

    gradientSubtractProgram.bind();
    gl.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    advectionProgram.bind();
    gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    if (!supportLinearFiltering) {
      gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    }
    const velocityId = velocity.read.attach(0);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
    gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
    gl.uniform1f(advectionProgram.uniforms.dt, deltaTime);
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.velocityDissipation);
    blit(velocity.write);
    velocity.swap();

    if (!supportLinearFiltering) {
      gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
    }
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.densityDissipation);
    blit(dye.write);
    dye.swap();
  }

  function render() {
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);
    displayMaterial.bind();
    if (config.shading) {
      gl.uniform2f(displayMaterial.uniforms.texelSize, 1 / gl.drawingBufferWidth, 1 / gl.drawingBufferHeight);
    }
    gl.uniform1i(displayMaterial.uniforms.uTexture, dye.read.attach(0));
    blit(null);
  }

  function correctRadius(radius) {
    const aspectRatio = canvas.width / canvas.height;
    return aspectRatio > 1 ? radius * aspectRatio : radius;
  }

  function splash(x, y, deltaX, deltaY, color) {
    splatProgram.bind();
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(splatProgram.uniforms.point, x, y);
    gl.uniform3f(splatProgram.uniforms.color, deltaX, deltaY, 0);
    gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.splatRadius / 100));
    blit(velocity.write);
    velocity.swap();

    gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
    blit(dye.write);
    dye.swap();
  }

  function logoColor() {
    const value = config.color.replace("#", "");
    return {
      r: (parseInt(value.slice(0, 2), 16) / 255) * 0.15,
      g: (parseInt(value.slice(2, 4), 16) / 255) * 0.15,
      b: (parseInt(value.slice(4, 6), 16) / 255) * 0.15,
    };
  }

  const pointer = {
    initialized: false,
    x: 0,
    y: 0,
    previousX: 0,
    previousY: 0,
    moved: false,
    color: logoColor(),
  };

  function updatePointer(clientX, clientY) {
    const pixelRatio = window.devicePixelRatio || 1;
    const x = (clientX * pixelRatio) / canvas.width;
    const y = 1 - (clientY * pixelRatio) / canvas.height;

    if (!pointer.initialized) {
      pointer.initialized = true;
      pointer.x = x;
      pointer.y = y;
      pointer.previousX = x;
      pointer.previousY = y;
      return;
    }

    pointer.previousX = pointer.x;
    pointer.previousY = pointer.y;
    pointer.x = x;
    pointer.y = y;
    pointer.moved = pointer.x !== pointer.previousX || pointer.y !== pointer.previousY;
  }

  function applyPointer() {
    if (!pointer.moved) return;
    pointer.moved = false;
    let deltaX = pointer.x - pointer.previousX;
    let deltaY = pointer.y - pointer.previousY;
    const aspectRatio = canvas.width / canvas.height;
    if (aspectRatio < 1) deltaX *= aspectRatio;
    if (aspectRatio > 1) deltaY /= aspectRatio;
    splash(
      pointer.x,
      pointer.y,
      deltaX * config.splatForce,
      deltaY * config.splatForce,
      pointer.color
    );
  }

  function handleMouseMove(event) {
    updatePointer(event.clientX, event.clientY);
  }

  function handleMouseDown(event) {
    updatePointer(event.clientX, event.clientY);
    const clickColor = logoColor();
    splash(
      pointer.x,
      pointer.y,
      10 * (Math.random() - 0.5),
      30 * (Math.random() - 0.5),
      { r: clickColor.r * 10, g: clickColor.g * 10, b: clickColor.b * 10 }
    );
  }

  function handleTouchStart(event) {
    const touch = event.targetTouches[0];
    if (touch) updatePointer(touch.clientX, touch.clientY);
  }

  function handleTouchMove(event) {
    const touch = event.targetTouches[0];
    if (touch) updatePointer(touch.clientX, touch.clientY);
  }

  let previousTime = performance.now();
  let animationFrame;
  let active = true;

  function updateFrame(now) {
    if (!active) return;
    const deltaTime = Math.min((now - previousTime) / 1000, 1 / 60);
    previousTime = now;
    if (resizeCanvas()) initializeFramebuffers();
    applyPointer();
    step(deltaTime);
    render();
    animationFrame = window.requestAnimationFrame(updateFrame);
  }

  function cleanUp() {
    active = false;
    window.cancelAnimationFrame(animationFrame);
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mousedown", handleMouseDown);
    window.removeEventListener("touchstart", handleTouchStart);
    window.removeEventListener("touchmove", handleTouchMove);
  }

  resizeCanvas();
  initializeFramebuffers();
  window.addEventListener("mousemove", handleMouseMove, { passive: true });
  window.addEventListener("mousedown", handleMouseDown, { passive: true });
  window.addEventListener("touchstart", handleTouchStart, { passive: true });
  window.addEventListener("touchmove", handleTouchMove, { passive: true });
  window.addEventListener("pagehide", cleanUp, { once: true });
  animationFrame = window.requestAnimationFrame(updateFrame);
})();
