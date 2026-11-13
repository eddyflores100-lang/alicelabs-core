export function validEncryptedVault(e){
  return e && typeof e==='object' && !Array.isArray(e) && e.version===1 &&
    e.kdf==='PBKDF2-SHA256' && Number.isInteger(e.iterations) &&
    e.iterations>=310000 && e.iterations<=1000000 &&
    typeof e.salt==='string' && /^[A-Za-z0-9+/=]{20,40}$/.test(e.salt) &&
    typeof e.iv==='string' && /^[A-Za-z0-9+/=]{12,24}$/.test(e.iv) &&
    typeof e.ciphertext==='string' && e.ciphertext.length>20 && e.ciphertext.length<=1100000 &&
    /^[A-Za-z0-9+/=]+$/.test(e.ciphertext);
}
