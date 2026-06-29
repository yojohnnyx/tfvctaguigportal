const http = require("http");
const querystring = require("querystring");
const postData = querystring.stringify({ email: "dev@dev.dev", password: "lovebydev" });
const opts = {
  hostname: "localhost",
  port: 3000,
  path: "/login",
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "Content-Length": Buffer.byteLength(postData)
  }
};
const req = http.request(opts, (res) => {
  console.log("POST /login status", res.statusCode);
  console.log("redirect", res.headers.location);
  let body = "";
  res.on("data", (d) => body += d);
  res.on("end", () => console.log("BODY", body.slice(0, 300)));
});
req.on("error", (e) => console.error("POST_ERR", e.message));
req.write(postData);
req.end();
