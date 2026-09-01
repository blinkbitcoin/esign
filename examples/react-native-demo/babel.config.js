module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Inline ESIGN_MODE at bundle time so `ESIGN_MODE=webform npm start`
    // selects the DocuSign Web Forms source (scoped to this one var).
    ['transform-inline-environment-variables', { include: ['ESIGN_MODE'] }],
  ],
};
