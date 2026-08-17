const auditPrototypeV2 = () => {
  const root = document.documentElement;
  const headings = [...document.querySelectorAll('.qds-TitleBlockV2-heading')];
  const fluidHeadings = [...document.querySelectorAll('.qds-TitleBlockV2--fluid .qds-TitleBlockV2-heading')];
  const hasHorizontalOverflow = root.scrollWidth > root.clientWidth;
  const emptyHeadings = headings.filter((heading) => !heading.textContent.trim());
  const fluidSizes = fluidHeadings.map((heading) => Number.parseFloat(getComputedStyle(heading).fontSize));
  const invalidFluidSizes = fluidSizes.filter((size) => size < 34 || size > 50);

  root.dataset.prototypeReady = 'true';
  root.dataset.horizontalOverflow = String(hasHorizontalOverflow);
  root.dataset.emptyHeadingCount = String(emptyHeadings.length);
  root.dataset.fluidSizes = fluidSizes.join(',');
  root.dataset.invalidFluidSizeCount = String(invalidFluidSizes.length);

  if (hasHorizontalOverflow || emptyHeadings.length > 0 || invalidFluidSizes.length > 0) {
    console.error('Title Block V2 prototype audit failed.', {
      hasHorizontalOverflow,
      emptyHeadingCount: emptyHeadings.length,
      fluidSizes,
      invalidFluidSizeCount: invalidFluidSizes.length,
    });
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', auditPrototypeV2, { once: true });
} else {
  auditPrototypeV2();
}
