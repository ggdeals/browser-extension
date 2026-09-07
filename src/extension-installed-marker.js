// This file must stay dependency-free. It is injected synchronously at
// document_start, before the content-script module loader
document.documentElement.classList.add('extension-installed');
