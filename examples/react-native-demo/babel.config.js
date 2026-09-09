module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Inline ESIGN_* at bundle time so `ESIGN_MODE=webform npm start` selects
    // the DocuSign Web Forms source, and the live run can point the bundle
    // at another backend port / a real form's prefill (scoped to these vars).
    [
      'transform-inline-environment-variables',
      { include: ['ESIGN_MODE', 'ESIGN_BACKEND_PORT', 'ESIGN_PREFILL'] },
    ],
  ],
};
