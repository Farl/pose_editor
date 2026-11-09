import { FINGERS, fingerStates } from "./handPoses.js";

const API_TIMEOUT_MS = 60_000;

/// Non-secret provider settings; config.runtime.js may override them. API keys
/// never come from config: each user enters their own (setApiKey), so a
/// deployed site never ships one.
const DEFAULT_CONFIG = {
  AI_PROVIDER: "pollinations",
  POLLINATIONS_API_BASE_URL: "https://gen.pollinations.ai",
  POLLINATIONS_IMAGE_MODEL: "kontext",
};

/// Where users get a Pollinations key; linked from the key field.
export const POLLINATIONS_KEY_URL = "https://enter.pollinations.ai";

/// The user's own Pollinations key, set from the UI.
let userApiKey = "";

export function setApiKey(key) {
  userApiKey = (key || "").trim();
}

const FALLBACK_IMAGE_MODELS = [
  { value: "kontext", label: "kontext (image+edit)", paidOnly: false },
  { value: "flux", label: "flux", paidOnly: false },
  { value: "gptimage", label: "gptimage", paidOnly: false },
];

function getConfig() {
  if (typeof window === "undefined") {
    return { ...DEFAULT_CONFIG };
  }

  return {
    ...DEFAULT_CONFIG,
    ...(window.POSE_EDITOR_CONFIG || {}),
  };
}

/// Edit instruction sent with [original image, pose guide].
/// IMAGE 0 owns who and how it is drawn (identity, style, clothes, palette);
/// IMAGE 1 owns the body and the camera: pose, viewing angle, perspective and
/// foreshortening, so dramatic guides are not flattened back to the original
/// eye-level view. The guide is an OpenPose skeleton (styles in poseStyles.js),
/// optionally with finger keypoints; `handLines` (describeHands) spell the
/// hand shapes out, since image models read finger keypoints poorly.
function getPrompt(handLines = []) {
  const handSection = handLines.length
    ? "\n\nHAND SHAPES (read from IMAGE 1, follow exactly):\n" + handLines.map((l) => `- ${l}`).join("\n")
    : "";
  return (
    "You are redrawing a reference image so its character takes the pose from a pose guide.\n\n" +
    "IMAGE 0 (CHARACTER AND STYLE REFERENCE):\n" +
    "- This is the original artwork or photo.\n" +
    "- Follow this image for: art style (anime vs realistic, painterly vs flat), line quality, rendering style, color palette, lighting mood, character identity, face, hair, age, body type, gender, and clothing design and colors.\n" +
    "- Keep the same setting and background environment, redrawn as seen from the new camera.\n" +
    "- Do not change the number of visible characters or turn them into different characters.\n\n" +
    "IMAGE 1 (POSE AND CAMERA GUIDE):\n" +
    "- This is an OpenPose-style skeleton from the pose editor, drawn on black.\n" +
    "- It defines the target pose AND the camera: follow it for body posture, joint positions, limb directions, where the figure sits in the frame, viewing angle (low angle, high angle, tilt), perspective and foreshortening.\n" +
    "- Short limbs in the guide are limbs pointing toward or away from the camera: draw them foreshortened, not shrunk. Differences in limb length between the two sides mean depth.\n" +
    "- If the guide includes finger keypoints, match each hand's finger shape and gesture to them. If it has no finger keypoints, draw natural hands that suit the pose.\n\n" +
    "TASK:\n" +
    "- Produce a new image of the same character(s), in exactly the same style, posed and framed as in IMAGE 1.\n" +
    "- Prefer the guide's pose, camera angle and perspective over the composition of IMAGE 0, even when that makes the shot more dramatic.\n" +
    "- Keep faces, hair, clothing, colors and body proportions consistent with IMAGE 0.\n" +
    "- Do NOT draw or overlay any rigs, joints, sticks, guides, or pose markers in the final result.\n" +
    "- The final image must look like a normal finished illustration or photo." +
    handSection
  );
}

/// "a, b and c"
const listWords = (words) => (words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : words[0]);

/// One line per hand saying which fingers are extended or curled. Hands are
/// named by where they are in the image, which image models follow more
/// reliably than the figure's own left and right.
function describeHands(joints) {
  const sides = ["r", "l"].sort((a, b) => joints[`wrist_${a}`].x - joints[`wrist_${b}`].x);
  return sides.map((side, i) => {
    const states = fingerStates(joints, side);
    const extended = FINGERS.filter((f) => states[f]);
    const curled = FINGERS.filter((f) => !states[f]);
    const where = i === 0 ? "image-left" : "image-right";
    let shape;
    if (!curled.length) shape = "open, all fingers extended";
    else if (!extended.length) shape = "a closed fist, all fingers curled into the palm";
    else shape = `${listWords(extended)} extended; ${listWords(curled)} curled into the palm`;
    return `The ${where} hand: ${shape}.`;
  });
}

function normalizeBaseUrl(url) {
  return url.replace(/\/$/, "");
}

function parseCostNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toModelOption(model) {
  const completionImageCost = parseCostNumber(model?.pricing?.completionImageTokens);
  const costLabel = completionImageCost !== null ? `${completionImageCost.toExponential(2)} pollen/img` : "cost: n/a";
  const supportsImageInput = Array.isArray(model?.input_modalities) && model.input_modalities.includes("image");
  const capability = supportsImageInput ? "image+edit" : "image-gen";
  const paidTag = model?.paid_only ? " paid" : "";
  return {
    value: model.name,
    label: `${model.name} (${capability}${paidTag}, ${costLabel})`,
    paidOnly: !!model?.paid_only,
    supportsImageInput,
    supportsImageOutput:
      Array.isArray(model?.output_modalities) && model.output_modalities.includes("image"),
  };
}

export async function fetchImageModels() {
  const config = getConfig();
  const baseUrl = normalizeBaseUrl(config.POLLINATIONS_API_BASE_URL);

  try {
    const response = await fetch(`${baseUrl}/image/models`);
    if (!response.ok) {
      throw new Error(`Image model fetch failed: ${response.status}`);
    }

    const catalog = await response.json();
    if (!Array.isArray(catalog)) {
      throw new Error("Unexpected model response.");
    }

    return catalog
      .filter((model) => model && typeof model.name === "string")
      .map(toModelOption)
      .filter((model) => model.supportsImageOutput)
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return [...FALLBACK_IMAGE_MODELS];
  }
}

export function filterImageModelsByCapability(models, { requiresImageInput = true, allowPaid = false } = {}) {
  return (models || []).filter((model) => {
    if (!allowPaid && model.paidOnly) return false;
    if (requiresImageInput && !model.supportsImageInput && model.value !== "kontext") return false;
    return true;
  });
}

export function setSelectedImageModel(modelName) {
  if (typeof window === "undefined") return;
  if (!window.POSE_EDITOR_CONFIG) {
    window.POSE_EDITOR_CONFIG = {};
  }
  window.POSE_EDITOR_CONFIG.POLLINATIONS_IMAGE_MODEL = modelName;
}

async function parseErrorResponse(response) {
  try {
    const data = await response.json();
    return data?.error?.message || data?.message || `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

async function postJson(url, options) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(await parseErrorResponse(response));
    }

    return await response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error("Request timed out after 60 s. Please try again.");
    }
    throw err;
  }
}

async function generateWithWebsim(imageDataUrl, poseImageDataUrl, prompt) {
  if (typeof websim === "undefined" || !websim.imageGen) {
    return null;
  }

  const image_inputs = [];
  if (imageDataUrl) image_inputs.push({ url: imageDataUrl });
  if (poseImageDataUrl) image_inputs.push({ url: poseImageDataUrl });

  const result = await websim.imageGen({
    prompt,
    image_inputs,
  });

  return result && result.url ? result.url : null;
}

async function generateWithPollinations(imageDataUrl, poseImageDataUrl, prompt, config) {
  const key = userApiKey;
  if (!key) {
    throw new Error("Add your Pollinations API key first");
  }

  const payload = {
    model: config.POLLINATIONS_IMAGE_MODEL || "kontext",
    prompt,
    image: [imageDataUrl, poseImageDataUrl],
    size: "1024x1024",
  };

  const baseUrl = normalizeBaseUrl(config.POLLINATIONS_API_BASE_URL);
  const url = `${baseUrl}/v1/images/edits?key=${encodeURIComponent(key)}`;
  const result = await postJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const imageData = result?.data?.[0];
  if (imageData?.url) {
    return imageData.url;
  }
  if (imageData?.b64_json) {
    return `data:image/png;base64,${imageData.b64_json}`;
  }
  return null;
}

/// Re-draw an uploaded image so the main figure matches the given pose.
/// `includeHands`: the guide shows finger keypoints, so the prompt also
/// spells out each hand's shape.
export async function generatePoseImage(imageDataUrl, pose, poseImageDataUrl, { includeHands = false } = {}) {
  const config = getConfig();
  const prompt = getPrompt(includeHands ? describeHands(pose.joints) : []);
  const provider = config.AI_PROVIDER || "pollinations";

  try {
    if (provider === "websim") {
      return await generateWithWebsim(imageDataUrl, poseImageDataUrl, prompt);
    }

    if (provider === "pollinations") {
      const websimResult = await generateWithWebsim(imageDataUrl, poseImageDataUrl, prompt);
      if (websimResult) {
        return websimResult;
      }
      return await generateWithPollinations(imageDataUrl, poseImageDataUrl, prompt, config);
    }

    throw new Error(`Unsupported AI provider: ${provider}`);
  } catch (e) {
    console.error(e);
    throw e;
  }
}