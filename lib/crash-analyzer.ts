export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type Finding = {
  id: string;
  title: string;
  severity: Severity;
  evidence: string;
  advice: string;
  location?: string;
};

export type CrashReport = {
  id: string;
  createdAt: string;
  packageName: string;
  appVersion: string;
  device: string;
  androidVersion: string;
  crashType: "Java/Kotlin" | "ANR" | "Native" | "Unknown";
  exception: string;
  message: string;
  location: string;
  stackTrace: string;
  findings: Finding[];
  rawText: string;
  source: "imported" | "demo";
};

const PATTERNS: Array<{
  id: string;
  match: RegExp;
  title: string;
  severity: Severity;
  advice: string;
}> = [
  {
    id: "verify",
    match: /VerifyError|verification failed/i,
    title: "Bytecode غير صالح (VerifyError)",
    severity: "critical",
    advice: "راجع عدد registers و.local/.registers وأنواع القيم في الدالة المعدلة، ثم افحص invoke-* وmove-result وtry/catch.",
  },
  {
    id: "method",
    match: /NoSuchMethodError|NoSuchMethodException/i,
    title: "استدعاء دالة غير موجود أو بتوقيع مختلف",
    severity: "high",
    advice: "قارن توقيع الدالة بين النسخة الأصلية والمعدلة، خصوصًا أنواع المعاملات ونوع الإرجاع وتعدد dex.",
  },
  {
    id: "field",
    match: /NoSuchFieldError/i,
    title: "حقل غير موجود أو تغيّر نوعه",
    severity: "high",
    advice: "تحقق من اسم الحقل ونوعه ومن أن الكلاس الصحيح موجود في الـ dex الذي يتم تحميله.",
  },
  {
    id: "class",
    match: /ClassNotFoundException|NoClassDefFoundError/i,
    title: "كلاس مفقود وقت التشغيل",
    severity: "high",
    advice: "تحقق من إدراج الكلاس في APK ومن ترتيب classpath وmulti-dex وملفات proguard/R8.",
  },
  {
    id: "null",
    match: /NullPointerException/i,
    title: "كائن غير مهيأ (NullPointerException)",
    severity: "high",
    advice: "راجع السطر المحدد، وأضف تحققًا من null قبل الاستدعاء. افحص مسار lifecycle والبيانات القادمة من Intent.",
  },
  {
    id: "cast",
    match: /ClassCastException/i,
    title: "تحويل نوع غير صحيح",
    severity: "high",
    advice: "تحقق من النوع الفعلي للكائن ومن casts بعد تعديل الواجهة أو الـ resources.",
  },
  {
    id: "resource",
    match: /Resources\$NotFoundException|InflateException/i,
    title: "مورد أو Layout غير صالح",
    severity: "high",
    advice: "راجع resource IDs وملفات XML والـ qualifiers وتوافق أسماء الموارد بعد إعادة البناء.",
  },
  {
    id: "security",
    match: /SecurityException|Permission denial/i,
    title: "رفض صلاحية أو وصول",
    severity: "medium",
    advice: "راجع AndroidManifest والصلاحية المطلوبة وسياق الاستدعاء، ولا تفترض أن صلاحية التطبيق موجودة على Android الحديث.",
  },
  {
    id: "native",
    match: /SIGSEGV|SIGABRT|Fatal signal|UnsatisfiedLinkError/i,
    title: "انهيار Native أو مكتبة ABI",
    severity: "critical",
    advice: "راجع مكتبات arm64/armeabi-v7a وملفات symbols وtombstone. افحص تحميل .so وتوافقها مع الجهاز.",
  },
  {
    id: "anr",
    match: /ANR|Application Not Responding|am_anr/i,
    title: "التطبيق لا يستجيب (ANR)",
    severity: "critical",
    advice: "ابحث عن عمل ثقيل على Main Thread، I/O متزامن، أو deadlock. قارن وقت بدء العملية مع traces.txt إن توفر.",
  },
  {
    id: "illegal-state",
    match: /IllegalStateException/i,
    title: "حالة غير صالحة أثناء التنفيذ",
    severity: "medium",
    advice: "راجع lifecycle وتسلسل الاستدعاءات، خصوصًا بعد تغيير Activity أو Fragment أو مشغل الفيديو.",
  },
];

function firstMatch(text: string, regex: RegExp): string | undefined {
  const match = text.match(regex);
  return match?.[0];
}

function findLocation(text: string): string {
  const frames = [...text.matchAll(/(?:^|\s)at\s+([\w.$]+)\(([^:)]+)(?::(\d+))?\)/gm)];
  const appFrame = frames.find((frame) => {
    const className = frame[1] || "";
    return !className.startsWith("android.") &&
      !className.startsWith("java.") &&
      !className.startsWith("javax.") &&
      !className.startsWith("dalvik.") &&
      !className.startsWith("com.android.");
  });
  const java = appFrame || frames[0];
  if (java) return `${java[1]} — ${java[2]}${java[3] ? `:${java[3]}` : ""}`;
  const smali = text.match(/(?:L[\w/$-]+;)->[\w$-]+\([^)]*\)[\w/$;]+/);
  if (smali) return smali[0];
  return "الموقع غير محدد — يلزم mapping أو stack trace إضافي";
}

function inferType(text: string): CrashReport["crashType"] {
  if (/ANR|Application Not Responding|am_anr/i.test(text)) return "ANR";
  if (/SIGSEGV|SIGABRT|Fatal signal|tombstone|native crash/i.test(text)) return "Native";
  if (/Exception|Error|FATAL EXCEPTION|at [\w.$]+\(/i.test(text)) return "Java/Kotlin";
  return "Unknown";
}

function extractLine(text: string, regex: RegExp, fallback: string): string {
  const match = text.match(regex);
  return match?.[1]?.trim() || fallback;
}

export function analyzeCrashText(rawText: string, meta?: Partial<Pick<CrashReport, "packageName" | "appVersion" | "device" | "androidVersion">>, source: CrashReport["source"] = "imported"): CrashReport {
  const text = rawText.trim();
  const findings: Finding[] = PATTERNS.filter((pattern) => pattern.match.test(text)).map((pattern) => ({
    id: pattern.id,
    title: pattern.title,
    severity: pattern.severity,
    evidence: firstMatch(text, pattern.match) || "مطابقة من التقرير",
    advice: pattern.advice,
    location: findLocation(text),
  }));

  if (!findings.length) {
    findings.push({
      id: "unknown",
      title: "لم يتم التعرف على نمط معروف",
      severity: "info",
      evidence: "التقرير لا يحتوي على استثناء قياسي واضح",
      advice: "أضف logcat كاملًا وstack trace مع mapping.txt، ثم أعد التحليل.",
      location: findLocation(text),
    });
  }

  const exception = extractLine(text, /FATAL EXCEPTION[^:]*:\s*([^\n\r]+)/i, findings[0].title);
  const message = extractLine(text, /(?:Exception|Error):\s*([^\n\r]+)/i, "لم تُستخرج رسالة منفصلة");
  const packageName = meta?.packageName || extractLine(text, /Package(?: Name)?[:=]\s*([^\s\n\r]+)/i, "غير معروف");
  const appVersion = meta?.appVersion || extractLine(text, /(?:versionName|Version)[:=]\s*([^\s\n\r]+)/i, "غير معروف");
  const device = meta?.device || extractLine(text, /(?:Model|Device)[:=]\s*([^\n\r]+)/i, "غير معروف");
  const androidVersion = meta?.androidVersion || extractLine(text, /(?:Android|SDK)[:=]\s*([^\n\r]+)/i, "غير معروف");

  const processPackage = extractLine(text, /Process:\s*([^,\s\n\r]+)/i, "");
  const reportedPackage = extractLine(text, /Package(?: Name)?[:=]\s*([^\s\n\r]+)/i, "");
  const actualPackage = processPackage || reportedPackage || packageName;
  if (processPackage && packageName !== "غير معروف" && processPackage !== packageName) {
    findings.unshift({
      id: "package-mismatch",
      title: "اسم الحزمة المدخل لا يطابق العملية المنهارة",
      severity: "high",
      evidence: `الحزمة المدخلة: ${packageName} — العملية الفعلية: ${processPackage}`,
      advice: "استخدم اسم الحزمة الظاهر في سطر Process أو Package. إذا كان التطبيق يعيد تشغيل عملية مختلفة، التقط التقرير من العملية الصحيحة.",
      location: "Process / Package metadata",
    });
  }

  return {
    id: `report-${Date.now()}`,
    createdAt: new Date().toISOString(),
    packageName: actualPackage,
    appVersion,
    device,
    androidVersion,
    crashType: inferType(text),
    exception,
    message,
    location: findLocation(text),
    stackTrace: text,
    findings,
    rawText: text,
    source,
  };
}

export const DEMO_REPORT = `FATAL EXCEPTION: main
Process: com.example.player, PID: 18420
Package: com.example.player
Version: 2.4.1
Device: SM-S918B
Android: 14
java.lang.NoSuchMethodError: No static method create(Ljava/lang/String;)Lcom/example/player/Config;
    at com.example.player.ui.PlayerActivity.initializePlayer(PlayerActivity.java:247)
    at com.example.player.ui.PlayerActivity.onCreate(PlayerActivity.java:91)
Caused by: java.lang.ClassNotFoundException: com.example.player.Config`;
