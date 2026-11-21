/** A bounded request is an interface contract, not an automatic retry mechanism. */
export function withinDeadline(task, milliseconds) {
  if (!Number.isInteger(milliseconds) || milliseconds <= 0 || milliseconds > 30000) {
    return Promise.reject(new Error('INVALID_DEADLINE'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), milliseconds);
    Promise.resolve().then(task).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}
