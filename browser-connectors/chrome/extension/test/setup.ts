// jsdom (used by vitest) doesn't implement Blob.arrayBuffer(), which Chrome 116+
// has natively. Back it with FileReader so the upload-interceptor helpers (which
// read file bytes) are testable. No effect on the shipped extension.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  // eslint-disable-next-line no-extend-native
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}
