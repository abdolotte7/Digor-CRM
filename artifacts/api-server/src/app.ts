import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import pinoHttp from "pino-http";
import compression from "compression";
import path from "path";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(compression());

app.set("etag", false);

app.use("/api", (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const ALLOWED_ORIGINS = [
  /^https:\/\/.*\.up\.railway\.app$/,
  /^https:\/\/.*\.digorva\.com$/,
  /^https:\/\/digorva\.com$/,
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = ALLOWED_ORIGINS.some((pattern) =>
      typeof pattern === "string" ? pattern === origin : pattern.test(origin)
    );
    if (allowed) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Tools-Pin"],
  credentials: true,
  maxAge: 86400,
};

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
  skipSuccessfulRequests: true,
});

const generalRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://googleapis.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https:", "https://gstatic.com", "data:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameSrc: ["https://maps.google.com", "https://www.google.com"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: { action: "deny" },
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  })
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  })
);

app.use(cors(corsOptions));
app.use(generalRateLimit);
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    logger.info(
      {
        url: req.url,
        contentType: req.headers["content-type"] ?? "(none)",
        contentLength: req.headers["content-length"] ?? "(none)",
        transferEncoding: req.headers["transfer-encoding"] ?? "(none)",
      },
      "incoming body request"
    );
  }
  next();
});

app.use(
  express.json({
    limit: "50mb",
    type: (req) => {
      const ct = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      return ct !== "application/x-www-form-urlencoded" && ct !== "multipart/form-data";
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api/crm/auth", authRateLimit);
app.use("/api/admin/login", authRateLimit);

app.use("/api", router);

// Serve static frontend builds in production
if (process.env.NODE_ENV === "production") {
  const cwd = process.cwd();

  const crmDir = path.join(cwd, "artifacts/digor-crm/dist/public");
  const toolsDir = path.join(cwd, "artifacts/digor-tools/dist/public");
  const websiteDir = path.join(cwd, "artifacts/digor-website/dist/public");

  app.use("/crm", express.static(crmDir));
  app.get("/crm/*path", (_req: Request, res: Response) => {
    res.sendFile(path.join(crmDir, "index.html"));
  });

  app.use("/tools", express.static(toolsDir));
  app.get("/tools/*path", (_req: Request, res: Response) => {
    res.sendFile(path.join(toolsDir, "index.html"));
  });

  app.use("/", express.static(websiteDir));
  app.get("/*path", (_req: Request, res: Response) => {
    res.sendFile(path.join(websiteDir, "index.html"));
  });
}

export default app;
