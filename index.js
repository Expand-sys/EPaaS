const root = process.env.PWD;
require("pino-pretty");
const dotenv = require("dotenv");

dotenv.config({ path: ".env" });
const fastify = require("fastify")({
  logger: false,
});

const fastifyFlash = require("fastify-flash");

const path = require("path");
const got = require("got");
const { Client } = require("ssh2");
const fs = require("fs");
const events = require("events");
const { MongoClient } = require("mongodb");
const uri = `mongodb+srv://${process.env.MONGODBUSR}:${process.env.MONGODBPW}@epaas.bfejg.mongodb.net/EPaaS?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

client.connect();

fastify.register(require("fastify-jwt"), { secret: "supersecret" });
fastify.register(require("fastify-leveldb"), { name: "authdb" });
fastify.register(require("fastify-auth"));
fastify.register(require("fastify-formbody"));
fastify.register(require("fastify-static"), {
  root: path.join(__dirname, "public"),
  prefix: "/", // optional: default '/'
});

fastify.register(require("fastify-secure-session"), {
  // the name of the session cookie, defaults to 'session'
  cookieName: "session",
  // adapt this to point to the directory where secret-key is located
  key: fs.readFileSync(path.join(__dirname, "secret-key")),
  cookie: {
    path: "/",
    // options for setCookie, see https://github.com/fastify/fastify-cookie
    secure: true,
    httpOnly: true,
    overwrite: true,
  },
});
fastify.register(fastifyFlash);
fastify.register(require("point-of-view"), {
  engine: {
    pug: require("pug"),
  },
  defaultContext: {},
  root: path.join(__dirname, "views"),
});
fastify.register(require("fastify-socket.io"), {
  // put your options here
});

const dukku = `${process.env.DUKKUHOST}`;

fastify.decorate("verifyJWTandLevelDB", verifyJWTandLevelDB);
fastify.decorate("verifyUserAndPassword", verifyUserAndPassword);

function verifyJWTandLevelDB(request, reply, done) {
  const jwt = this.jwt;
  const level = this.level.authdb;

  if (request.body && request.body.failureWithReply) {
    reply.code(401).send({ error: "Unauthorized" });
    return done(new Error());
  }

  if (!request.raw.headers.auth) {
    return done(new Error("Missing token header"));
  }

  jwt.verify(request.raw.headers.auth, onVerify);

  function onVerify(err, decoded) {
    if (err || !decoded.user || !decoded.password) {
      return done(new Error("Token not valid"));
    }

    level.get(decoded.user, onUser);

    function onUser(err, password) {
      if (err) {
        if (err.notFound) {
          return done(new Error("Token not valid"));
        }
        return done(err);
      }

      if (!password || password !== decoded.password) {
        return done(new Error("Token not valid"));
      }

      done();
    }
  }
}

async function verifypass(req, res, done) {
  let test = req.session.get("token");
  const level = this.level.authdb;
  let userdb = await level.get(req.session.get("user"));
  if (test != userdb) {
    req.session.delete();
    req.session.set("errors", "BACK FROM WHENCE YOU CAME");
    res.redirect("/login");
  }
  done(); // pass an error if the authentication fails
}

function verifyUserAndPassword(request, reply, done) {
  const level = this.level.authdb;

  if (!request.body || !request.body.user) {
    return done(new Error("Missing user in request body"));
  }

  level.get(request.body.user, onUser);

  function onUser(err, password) {
    if (err) {
      if (err.notFound) {
        return done(new Error("Password not valid"));
      }
      return done(err);
    }

    if (!password || password !== request.body.password) {
      return done(new Error("Password not valid"));
    }

    done();
  }
}

function validate(req, res, next) {
  if (req.session.get("user")) {
    next();
  } else {
    res.redirect("/login");
  }
}

function sendCommand(command) {
  let output;
  const conn = new Client();
  try {
    conn
      .on("ready", () => {
        console.log("SSH Client Ready");
        conn.exec(`${command}`, (err, stream) => {
          if (err) throw err;
          stream
            .on("close", (code, signal) => {
              console.log(
                "Stream :: close :: code: " + code + ", signal: " + signal
              );
              conn.end();
            })
            .on("data", (data) => {
              console.log("STDOUT: " + data);
              fastify.io.emit("online");
              fastify.io.emit("data", data);
            })
            .stderr.on("data", (data) => {
              console.log("STDERR: " + data);
              fastify.io.emit("offline");
              fastify.io.emit("error", data);
            });
        });
      })
      .connect({
        host: `${process.env.DUKKUHOST}`,
        port: 22,
        username: `dokku`,
        privateKey: fs.readFileSync("/home/harrison/.ssh/id_rsa"),
      });
  } catch (err) {
    console.log(err);
    fastify.io.emit("offline");
  }
}

fastify.post("/setup", async function (req, res) {
  const { url, secure } = req.body;
  if (secure) {
    process.env.SECURE = true;
  }
  process.env.DUKKUHOST = url;
  fs.rmSync(`${root}/.env`);
  fs.writeFileSync(
    `${root}/.env`,
    "DUKKUHOST=" +
      process.env.DUKKUHOST +
      "\n" +
      "SECURE=" +
      process.env.SECURE +
      "\nSETUP=true"
  );

  fs.writeFileSync(`${root}/tmp/restart.txt`, "");
  res.redirect("/");
});

fastify.get("/", async function (req, res) {
  let successes = req.session.get("successes");
  req.session.set("successes", "");
  let errors = req.session.get("errors");
  req.session.set("errors", "");
  if (process.env.SETUP == false || !process.env.SETUP) {
    res.view("setup");
  }
  let alive = await sendCommand("version");

  res.view("index", {
    user: req.session.get("user"),
    admin: req.session.get("admin"),
    alive: alive,
    url: process.env.DUKKUHOST,
    errors: errors,
    successes: successes,
  });
});
fastify.get(
  "/main",
  {
    preValidation: [verifypass],
  },
  async function (req, res) {
    let successes = req.session.get("successes");
    req.session.set("successes", "");
    let errors = req.session.get("errors");
    req.session.set("errors", "");
    let alive = await sendCommand("version");

    res.view("bankf", {
      user: req.session.get("user"),
      admin: admintest(req.session.get("user")),
      sucesses: successes,
      errors: errors,
      alive: alive,
    });
  }
);
function admintest(user) {
  let admin = process.env.ADMINUSERNAME;
  if (user == admin) {
    return true;
  }
  return false;
}

fastify.post(
  "/sendfunds",
  {
    preValidation: [validate],
  },
  async function (req, res) {
    let { amount, name, senderpass } = req.body;
    req.session.set("errors", "");
    req.session.set("successes", "");
    let result;
    let auth = req.session.get("b64");
    try {
      result = await got.post(`${api}user/transfer`, {
        headers: {
          Authorization: auth,
          Accept: "application/json",
        },
        json: {
          name: name,
          amount: parseInt(amount),
        },
      });
    } catch (e) {
      req.session.set("errors", `${e}`);
    }
    if (result) {
      req.session.set("successes", "Transfer successful");
      //post details
    }
    res.redirect("/BankF");
  }
);

fastify.route({
  method: "POST",
  url: "/register",
  schema: {
    body: {
      type: "object",
      properties: {
        user: { type: "string" },
        password: { type: "string" },
      },
      required: ["user", "password"],
    },
  },
  handler: (req, reply) => {
    req.log.info("Creating new user");
    if (req.body.password2 == req.body.password) {
      const token = fastify.jwt.sign(req.body);
      fastify.level.authdb.put(req.body.user, token, onPut);
      function onPut(err) {
        if (err) return reply.send(err);
      }
      req.log.info("User created");
      req.session.set("token", token);
      req.session.set("successes", "User Created!");
      reply.redirect("/main");
    } else {
      req.session.set("errors", "Passwords dont match!");
      reply.redirect("/register");
    }
  },
});

fastify.post("/login", async function (req, res) {
  const { user, password } = req.body;
  const level = this.level.authdb;
  let userdb = await level.get(req.body.user);
  userdb = fastify.jwt.decode(userdb);

  if (userdb.user == user && userdb.password == password) {
    const token = await level.get(req.body.user);
    req.session.set("token", token);
    req.session.set("user", req.body.user);
  }
  res.redirect("/main");
});

fastify.register(require("./routes/admin"), { prefix: "/admin" });

fastify.register(require("./routes/settings"), { prefix: "/settings" });

fastify.get("/logout", async function (req, res) {
  let successes = req.session.get("successes");
  let errors = req.session.get("errors");
  req.session.delete();
  req.session.set("successes", successes);
  req.session.set("errors", errors);
  res.redirect("login");
});

fastify.get("/login", async function (req, res) {
  let successes = req.session.get("successes");
  req.session.set("successes", "");
  let errors = req.session.get("errors");
  req.session.set("errors", "");
  //let checkalive = await client.ping();
  let alive = await sendCommand("version");
  res.view("login", {
    successes: successes,
    errors: errors,
    user: req.session.get("user"),
    alive: alive,
  });
});

fastify.get("/register", async function (req, res) {
  let successes = req.session.get("successes");
  req.session.set("successes", "");
  let errors = req.session.get("errors");
  req.session.set("errors", "");
  //let checkalive = await client.ping();
  let alive = await sendCommand("version");
  res.view("register", {
    successes: successes,
    errors: errors,
    user: req.session.get("user"),
    admin: req.session.get("admin"),
    alive: alive,
  });
});
process.on("SIGINT", function () {
  client.close();
  process.exit();
});

fastify.listen(process.env.PORT || 3000, "0.0.0.0", function (err, address) {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`server listening on ${address}`);
  console.log(`server running on ${address}`);
});
