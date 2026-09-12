import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";

const V10 = Buffer.from("v10");
const V11 = Buffer.from("v11");
const CBC_IV = Buffer.alloc(16, 0x20);

export function prefixOf(buf) {
  return buf.subarray(0, 3).toString("latin1");
}

export function decryptV10Gcm(blob, aesKey) {
  if (!Buffer.isBuffer(blob) || blob.length < 3 + 12 + 16) {
    throw new Error("OSCrypt v10 blob is too short.");
  }
  if (prefixOf(blob) !== "v10") throw new Error("Expected OSCrypt v10 prefix.");
  const iv = blob.subarray(3, 15);
  const tag = blob.subarray(blob.length - 16);
  const data = blob.subarray(15, blob.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", aesKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export function encryptV10Gcm(plain, aesKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([V10, iv, data, cipher.getAuthTag()]);
}

export function cbcKey(password, platform) {
  const iterations = platform === "linux" ? 1 : 1003;
  return pbkdf2Sync(password, "saltysalt", iterations, 16, "sha1");
}

export function decryptV10Cbc(blob, password, platform = "darwin") {
  const prefix = prefixOf(blob);
  if (prefix !== "v10" && prefix !== "v11") {
    throw new Error("Unsupported OSCrypt prefix " + JSON.stringify(prefix));
  }
  const linuxBasic = platform === "linux" && prefix === "v10";
  const key = cbcKey(linuxBasic ? "peanuts" : password, platform);
  const decipher = createDecipheriv("aes-128-cbc", key, CBC_IV);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(blob.subarray(3)), decipher.final()]);
}

export function isV20(blob) {
  return prefixOf(blob) === "v20";
}

export { V10, V11 };
