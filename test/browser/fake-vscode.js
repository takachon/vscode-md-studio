// Stand-in for the VS Code webview API when the webviews are driven by Playwright.
window.__posted = [];
window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__posted.push(JSON.parse(JSON.stringify(m))) });
window.__send = (m) => window.postMessage(m, '*');
window.__csp = [];
document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
