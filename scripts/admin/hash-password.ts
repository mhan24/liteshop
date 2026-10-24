import { hashPassword } from "../../src/server/password-cli";

const password = process.argv[2];
if (!password) {
  console.error("用法: npm run hash-password -- <密码>");
  process.exit(1);
}
console.log(hashPassword(password));
