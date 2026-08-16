const auditPrototype = () => {
  const root = document.documentElement;
  const hasHorizontalOverflow = root.scrollWidth > root.clientWidth;
  const headings = [...document.querySelectorAll('.qds-TitleBlockV2-heading')];
  const emptyHeadings = headings.filter((heading) => !heading.textContent.trim());

  root.dataset.prototypeReady = 'true';
  root.dataset.horizontalOverflow = String(hasHorizontalOverflow);
  root.dataset.emptyHeadingCount = String(emptyHeadings.length);

  if (hasHorizontalOverflow || emptyHeadings.length > 0) {
    console.error('Title Block V2 prototype audit failed.', {
      hasHorizontalOverflow,
      emptyHeadingCount: emptyHeadings.length,
    });
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', auditPrototype, { once: true });
} else {
  auditPrototype();
}
