module.exports = async (req, res) => {
  res.setHeader(
    'Set-Cookie',
    'token=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0'
  );
  return res.status(200).json({ success: true });
};
