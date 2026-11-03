// Read by bb-build.sh: the Babylon.js API surface used by assets/babylon/bb-scene/.
// Deep imports keep the bundle to what the scene needs; the *SceneComponent imports are side effects
// that register features (shadows, depth/geometry buffers, render pipelines) on Scene.
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js';
import '@babylonjs/core/Rendering/depthRendererSceneComponent.js';
import '@babylonjs/core/Rendering/geometryBufferRendererSceneComponent.js';
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent.js';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import '@babylonjs/core/Materials/Textures/baseTexture.polynomial.js';
// Registered up front (not lazily with the PBR shader) so bb-parity.js can patch them before first compile.
import '@babylonjs/core/Shaders/ShadersInclude/fogFragment.js';
import '@babylonjs/core/Shaders/ShadersInclude/fogFragmentDeclaration.js';
import '@babylonjs/core/Shaders/ShadersInclude/pbrDirectLightingFalloffFunctions.js';
import '@babylonjs/core/Shaders/ShadersInclude/pbrDirectLightingFunctions.js';
import '@babylonjs/core/Shaders/ShadersInclude/pbrIBLFunctions.js';

export { Engine } from '@babylonjs/core/Engines/engine.js';
export { Constants } from '@babylonjs/core/Engines/constants.js';
export { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
export { Scene } from '@babylonjs/core/scene.js';
export { Matrix, Quaternion, Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
export { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
export { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
export { Mesh } from '@babylonjs/core/Meshes/mesh.js';
export { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
export { Geometry } from '@babylonjs/core/Meshes/geometry.js';
export { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
export { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo.js';
export { TargetCamera } from '@babylonjs/core/Cameras/targetCamera.js';
export { Material } from '@babylonjs/core/Materials/material.js';
export { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
export { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
export { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration.js';
export { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
export { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
export { HDRFiltering } from '@babylonjs/core/Materials/Textures/Filtering/hdrFiltering.js';
export { CubeMapToSphericalPolynomialTools } from '@babylonjs/core/Misc/HighDynamicRange/cubemapToSphericalPolynomial.js';
export { Light } from '@babylonjs/core/Lights/light.js';
export { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
export { PointLight } from '@babylonjs/core/Lights/pointLight.js';
export { SpotLight } from '@babylonjs/core/Lights/spotLight.js';
export { RectAreaLight } from '@babylonjs/core/Lights/rectAreaLight.js';
export { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
export { ReflectionProbe } from '@babylonjs/core/Probes/reflectionProbe.js';
export { PostProcess } from '@babylonjs/core/PostProcesses/postProcess.js';
export { BloomEffect } from '@babylonjs/core/PostProcesses/bloomEffect.js';
export { ImageProcessingPostProcess } from '@babylonjs/core/PostProcesses/imageProcessingPostProcess.js';
export { PostProcessRenderPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipeline.js';
export { PostProcessRenderEffect } from '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderEffect.js';
export { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline.js';
export { Tools } from '@babylonjs/core/Misc/tools.js';
export { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation.js';
