export function initSidebar({
  onReset,
  onUndo,
  onRedo,
  onMirror,
  onDownload,
  onJointSizeChange,
  onLinkScaleChange,
  onImageFileChange,
  onGenerateImageClick,
}) {
  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  const resetBtn = document.getElementById("resetBtn");
  const mirrorBtn = document.getElementById("mirrorBtn");
  const downloadBtn = document.getElementById("downloadBtn");
  const jointSizeInput = document.getElementById("jointSizeInput");
  const linkScaleInput = document.getElementById("linkScaleInput");
  const imageInput = document.getElementById("imageInput");
  const generateImageBtn = document.getElementById("generateImageBtn");

  resetBtn.addEventListener("click", () => onReset && onReset());
  undoBtn.addEventListener("click", () => onUndo && onUndo());
  redoBtn.addEventListener("click", () => onRedo && onRedo());
  mirrorBtn.addEventListener("click", () => onMirror && onMirror());
  downloadBtn.addEventListener("click", () => onDownload && onDownload());

  jointSizeInput.addEventListener("input", (e) => {
    const v = Number(e.target.value) || 8;
    onJointSizeChange && onJointSizeChange(v);
  });

  if (linkScaleInput) {
    linkScaleInput.addEventListener("input", (e) => {
      const v = Number(e.target.value) || 1;
      onLinkScaleChange && onLinkScaleChange(v);
    });
  }

  if (imageInput) {
    imageInput.addEventListener("change", (e) => {
      const target = e.target;
      const file = target && target.files && target.files[0];
      if (file && onImageFileChange) {
        onImageFileChange(file);
      }
    });
  }

  if (generateImageBtn) {
    generateImageBtn.addEventListener("click", () => {
      onGenerateImageClick && onGenerateImageClick();
    });
  }

  function setUndoRedoState(canUndo, canRedo) {
    undoBtn.disabled = !canUndo;
    redoBtn.disabled = !canRedo;
  }

  return {
    setUndoRedoState,
  };
}