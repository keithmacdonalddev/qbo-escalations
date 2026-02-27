import { useState, useRef, useCallback } from 'react';

export default function ImageUpload({ images, onImagesChange, disabled }) {
  const [isDragover, setIsDragover] = useState(false);
  const inputRef = useRef(null);

  const processFiles = useCallback((files) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    const readers = imageFiles.map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
    });

    Promise.all(readers).then(results => {
      onImagesChange(prev => [...prev, ...results]);
    });
  }, [onImagesChange]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragover(false);
    if (disabled) return;
    processFiles(e.dataTransfer.files);
  }, [disabled, processFiles]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    if (!disabled) setIsDragover(true);
  }, [disabled]);

  const handleDragLeave = useCallback(() => {
    setIsDragover(false);
  }, []);

  const handleClick = useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  const handleFileChange = useCallback((e) => {
    processFiles(e.target.files);
    e.target.value = '';
  }, [processFiles]);

  const removeImage = useCallback((index) => {
    onImagesChange(prev => prev.filter((_, i) => i !== index));
  }, [onImagesChange]);

  // Handle paste from clipboard
  const handlePaste = useCallback((e) => {
    if (disabled) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'));
    if (imageItems.length > 0) {
      e.preventDefault();
      const files = imageItems.map(item => item.getAsFile()).filter(Boolean);
      processFiles(files);
    }
  }, [disabled, processFiles]);

  return (
    <div onPaste={handlePaste}>
      {images.length > 0 && (
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', marginBottom: 'var(--sp-3)' }}>
          {images.map((src, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img
                src={src}
                alt={`Upload ${i + 1}`}
                style={{
                  width: 64,
                  height: 64,
                  objectFit: 'cover',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--line)',
                }}
              />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="btn btn-sm btn-danger"
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  width: 20,
                  height: 20,
                  minHeight: 'auto',
                  padding: 0,
                  fontSize: '11px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label={`Remove image ${i + 1}`}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        className={`upload-zone upload-zone-compact${isDragover ? ' is-dragover' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
        aria-label="Upload images"
      >
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
          Drop images here, click to upload, or paste (Ctrl+V)
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
}
