import { useCallback } from 'react';
import { listTemplates, trackTemplateUsage } from '../../api/templatesApi.js';
import { prepareImageForChat } from '../../lib/chatImagePrep.js';
import { useToast } from '../../hooks/useToast.jsx';

export default function useChatComposerMediaAndTemplates({
  setImages,
  isStreaming,
  imageInputRef,
  isComposeDragOver,
  setIsComposeDragOver,
  templateCategory,
  setTemplateCategory,
  setLoadingTemplates,
  setShowTemplatePicker,
  setTemplates,
  textareaRef,
  setInput,
  appendProcessEvent,
  setShowWebcam,
  setShowImageParser,
  setImageParserSeed,
}) {
  const toast = useToast();

  const openImageParserForSrc = useCallback((src, source = 'upload') => {
    if (!src) return;
    setImages([]);
    setImageParserSeed({
      src,
      key: `${source}-${Date.now()}`,
      source,
    });
    setShowImageParser(true);
  }, [setImageParserSeed, setImages, setShowImageParser]);

  const appendImageFiles = useCallback(async (files) => {
    const imageFiles = Array.from(files || []).filter((file) => file?.type?.startsWith('image/'));
    if (imageFiles.length === 0) return;

    const firstFile = imageFiles[0];
    try {
      const prepared = await prepareImageForChat(firstFile);
      if (!prepared?.src) {
        throw new Error('No image data returned');
      }
      openImageParserForSrc(prepared.src, 'upload');
      appendProcessEvent({
        level: 'info',
        title: 'Image parser ready',
        message: `Loaded "${firstFile.name || 'image'}" into the image parser.`,
        code: 'IMAGE_PARSER_LOADED',
        imageCount: 1,
      });
      if (imageFiles.length > 1) {
        toast.info('Image parser handles one image at a time. Loaded the first image.');
      }
    } catch {
      toast.error('Failed to load the selected image.');
    }
  }, [appendProcessEvent, openImageParserForSrc, toast]);

  const removeImage = useCallback((index) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    appendProcessEvent({
      level: 'info',
      title: 'Image removed',
      message: `Removed attachment ${index + 1}.`,
      code: 'IMAGE_REMOVED',
    });
  }, [appendProcessEvent, setImages]);

  const hasImageItems = useCallback((dataTransfer) => {
    if (!dataTransfer) return false;
    const items = Array.from(dataTransfer.items || []);
    if (items.some((item) => item.kind === 'file' && item.type.startsWith('image/'))) return true;
    const files = Array.from(dataTransfer.files || []);
    return files.some((file) => file?.type?.startsWith('image/'));
  }, []);

  const handleAttachClick = useCallback(() => {
    if (isStreaming) return;
    imageInputRef.current?.click();
  }, [imageInputRef, isStreaming]);

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems = Array.from(items).filter((item) => item.type.startsWith('image/'));
    if (imageItems.length > 0) {
      e.preventDefault();
      const files = imageItems.map((item) => item.getAsFile()).filter(Boolean);
      void appendImageFiles(files);
    }
  }, [appendImageFiles]);

  const handleWebcamCapture = useCallback(async (payload) => {
    const src = typeof payload === 'string' ? payload : payload?.src;
    if (!src) return;
    setShowWebcam(false);
    openImageParserForSrc(src, 'webcam');
    appendProcessEvent({
      level: 'info',
      title: 'Webcam parser ready',
      message: 'Photo captured from webcam and loaded into the image parser.',
      code: 'WEBCAM_PARSER_LOADED',
      imageCount: 1,
    });
  }, [appendProcessEvent, openImageParserForSrc, setShowWebcam]);

  const handleFilePickerChange = useCallback((e) => {
    void appendImageFiles(e.target.files);
    e.target.value = '';
  }, [appendImageFiles]);

  const handleComposeDragEnter = useCallback((e) => {
    if (isStreaming || !hasImageItems(e.dataTransfer)) return;
    e.preventDefault();
    setIsComposeDragOver(true);
  }, [hasImageItems, isStreaming, setIsComposeDragOver]);

  const handleComposeDragOver = useCallback((e) => {
    if (isStreaming || !hasImageItems(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isComposeDragOver) {
      setIsComposeDragOver(true);
    }
  }, [hasImageItems, isComposeDragOver, isStreaming, setIsComposeDragOver]);

  const handleComposeDragLeave = useCallback((e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsComposeDragOver(false);
  }, [setIsComposeDragOver]);

  const handleComposeDrop = useCallback((e) => {
    if (!hasImageItems(e.dataTransfer)) return;
    e.preventDefault();
    setIsComposeDragOver(false);
    if (isStreaming) return;
    void appendImageFiles(e.dataTransfer.files);
  }, [appendImageFiles, hasImageItems, isStreaming, setIsComposeDragOver]);

  const openTemplatePicker = useCallback(async () => {
    setShowTemplatePicker(true);
    setLoadingTemplates(true);
    try {
      const list = await listTemplates(templateCategory || undefined);
      setTemplates(list);
    } catch {
      toast.error('Failed to load templates');
    } finally {
      setLoadingTemplates(false);
    }
  }, [setLoadingTemplates, setShowTemplatePicker, setTemplates, templateCategory, toast]);

  const handleTemplateInsert = useCallback((template) => {
    setInput((prev) => (prev ? `${prev}\n\n${template.body}` : template.body));
    setShowTemplatePicker(false);
    trackTemplateUsage(template._id).catch(() => {});
    textareaRef.current?.focus();
  }, [setInput, setShowTemplatePicker, textareaRef]);

  const handleTemplateCategoryChange = useCallback(async (cat) => {
    setTemplateCategory(cat);
    setLoadingTemplates(true);
    try {
      const list = await listTemplates(cat || undefined);
      setTemplates(list);
    } catch {
      toast.error('Failed to load templates');
    } finally {
      setLoadingTemplates(false);
    }
  }, [setLoadingTemplates, setTemplateCategory, setTemplates, toast]);

  return {
    handleAttachClick,
    handlePaste,
    handleWebcamCapture,
    handleFilePickerChange,
    handleComposeDragEnter,
    handleComposeDragOver,
    handleComposeDragLeave,
    handleComposeDrop,
    openTemplatePicker,
    handleTemplateInsert,
    handleTemplateCategoryChange,
    removeImage,
  };
}
