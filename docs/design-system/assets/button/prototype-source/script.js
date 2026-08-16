document.querySelectorAll('[data-loading="true"]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  });
});
