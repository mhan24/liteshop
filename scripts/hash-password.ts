import { hashPassword } from "../src/lib/password";

const pw = process.argv[2];
if (!pw) {
  console.error("用法: npm run hash-password -- <密码>");
  process.exit(1);
}
console.log(hashPassword(pw));
