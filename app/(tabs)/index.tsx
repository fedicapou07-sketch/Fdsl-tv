import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import {
  analyzeCrashText,
  DEMO_REPORT,
  type CrashReport,
  type Finding,
  type Severity,
} from "@/lib/crash-analyzer";

const severityLabel: Record<Severity, string> = {
  critical: "حرج",
  high: "مرتفع",
  medium: "متوسط",
  low: "منخفض",
  info: "معلومات",
};

const severityColor: Record<Severity, string> = {
  critical: "#C2410C",
  high: "#DC2626",
  medium: "#D97706",
  low: "#2563EB",
  info: "#64748B",
};

function formatReport(report: CrashReport) {
  const findings = report.findings
    .map((finding) => `- [${severityLabel[finding.severity]}] ${finding.title}\n  الدليل: ${finding.evidence}\n  الإجراء: ${finding.advice}`)
    .join("\n");
  return [
    "CRASHSCOPE ANDROID LAB — DEBUG REPORT",
    `التاريخ: ${new Date(report.createdAt).toLocaleString("ar-TN")}`,
    `الحزمة: ${report.packageName}`,
    `الإصدار: ${report.appVersion}`,
    `الجهاز: ${report.device}`,
    `Android: ${report.androidVersion}`,
    `نوع العطل: ${report.crashType}`,
    `الاستثناء: ${report.exception}`,
    `الموقع: ${report.location}`,
    "",
    "النتائج:",
    findings,
    "",
    "STACK TRACE / LOGCAT:",
    report.stackTrace,
  ].join("\n");
}

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <View style={styles.findingCard}>
      <View style={styles.findingHeader}>
        <View style={[styles.severityDot, { backgroundColor: severityColor[finding.severity] }]} />
        <Text style={styles.findingTitle}>{finding.title}</Text>
        <Text style={[styles.severityText, { color: severityColor[finding.severity] }]}>
          {severityLabel[finding.severity]}
        </Text>
      </View>
      <Text style={styles.findingEvidence}>{finding.evidence}</Text>
      <Text style={styles.findingAdvice}>{finding.advice}</Text>
      {finding.location ? <Text style={styles.findingLocation}>الموقع: {finding.location}</Text> : null}
    </View>
  );
}

export default function HomeScreen() {
  const [report, setReport] = useState<CrashReport | null>(null);
  const [packageName, setPackageName] = useState("com.example.player");
  const [appVersion, setAppVersion] = useState("غير محدد");
  const [isCapturing, setIsCapturing] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState("جسر Android غير مفحوص");
  const [status, setStatus] = useState("جاهز لفحص تطبيق مصرح به");

  const reportText = useMemo(() => (report ? formatReport(report) : ""), [report]);

  const analyze = (text: string, source: CrashReport["source"]) => {
    const next = analyzeCrashText(text, {
      packageName,
      appVersion,
      device: "Samsung — يتم تحديده من التقرير",
      androidVersion: "Android 13+ — يتم تحديده من التقرير",
    }, source);
    setReport(next);
    setStatus("تم تحليل التقرير محليًا دون رفع البيانات");
  };

  const loadDemo = () => {
    analyze(DEMO_REPORT, "demo");
  };

  const importReport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const lowerName = asset.name.toLowerCase();
      if (lowerName.endsWith(".apk") || lowerName.endsWith(".apks") || lowerName.endsWith(".xapk")) {
        setStatus("تم اختيار APK. الإصدار الحالي يحلل ملفات التقرير النصية؛ سيضاف محلل APK في المرحلة التالية.");
        Alert.alert("APK محفوظ للجلسة", "هذا الملف ليس تقريرًا نصيًا. استورد logcat أو bugreport أو stack trace لتحليل العطل.");
        return;
      }
      const text = await FileSystem.readAsStringAsync(asset.uri);
      analyze(text, "imported");
    } catch {
      setStatus("تعذر قراءة الملف");
      Alert.alert("تعذر الاستيراد", "اختر ملف logcat أو bugreport أو stack trace نصيًا.");
    }
  };

  const saveReport = async () => {
    if (!report) return;
    try {
      const filename = `crashscope-${report.id}.txt`;
      const uri = `${FileSystem.documentDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(uri, reportText);
      setStatus(`تم حفظ التقرير محليًا: ${filename}`);
      Alert.alert("تم الحفظ", `حُفظ التقرير داخل مساحة التطبيق المحلية.\n${uri}`);
    } catch {
      Alert.alert("تعذر الحفظ", "تعذر إنشاء ملف التقرير على هذا الجهاز.");
    }
  };

  const shareReport = async () => {
    if (!report) return;
    await Share.share({ title: "CrashScope Debug Report", message: reportText });
  };

  const toggleCapture = async () => {
    if (isCapturing) {
      const native = NativeModules.CrashScopeNative as { stopCapture?: () => Promise<string> } | undefined;
      const rawReport = await native?.stopCapture?.();
      setIsCapturing(false);
      if (rawReport?.trim()) {
        analyze(rawReport, "imported");
      } else {
        setStatus("توقفت جلسة الالتقاط — لم تصل أسطر Crash مطابقة للحزمة");
      }
      return;
    }
    if (Platform.OS !== "android") {
      setStatus("التقاط الجهاز متاح داخل APK Android فقط");
      return;
    }
    const native = NativeModules.CrashScopeNative as {
      getBridgeStatus?: () => Promise<{ canStartCapture: boolean; transport: string; permissionGranted: boolean }>;
      requestShizukuPermission?: () => Promise<boolean>;
      startCapture?: (targetPackage: string) => Promise<boolean>;
    } | undefined;
    if (!native?.getBridgeStatus) {
      setStatus("نسخة التطوير الحالية لا تحتوي على جسر Android الأصلي");
      return;
    }
    const current = await native.getBridgeStatus();
    if (!current.permissionGranted) {
      setBridgeStatus(current.transport === "unavailable" ? "Shizuku غير متصل" : "Shizuku يحتاج موافقة");
      await native.requestShizukuPermission?.();
      setStatus("امنح CrashScope صلاحية Shizuku ثم اضغط بدء جلسة مرة أخرى");
      return;
    }
    setBridgeStatus(`Shizuku متصل عبر ${current.transport}`);
    const started = await native.startCapture?.(packageName);
    if (!started) {
      setStatus("تعذر بدء خدمة الالتقاط؛ تحقق من صلاحية Shizuku ثم أعد المحاولة");
      return;
    }
    setIsCapturing(true);
    setStatus(`جلسة التقاط حقيقية للحزمة ${packageName} — افتح التطبيق المستهدف ثم أعده للتحليل`);
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>ANDROID DIAGNOSTICS LAB</Text>
            <Text style={styles.title}>CrashScope</Text>
            <Text style={styles.subtitle}>مختبر تشخيص لتطبيقات Android المصرّح بها</Text>
          </View>
          <View style={styles.statusBadge}>
            <View style={[styles.statusDot, { backgroundColor: isCapturing ? "#22C55E" : "#94A3B8" }]} />
            <Text style={styles.statusBadgeText}>{isCapturing ? "يلتقط" : "محلي"}</Text>
          </View>
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroIcon}><Text style={styles.heroIconText}>⌁</Text></View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>جلسة فحص جديدة</Text>
            <Text style={styles.heroText}>شغّل التطبيق المعدّل، ثم استورد logcat أو bugreport أو stack trace. التحليل يتم على الهاتف.</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>التطبيق المستهدف</Text>
        <View style={styles.card}>
          <Text style={styles.inputLabel}>اسم الحزمة</Text>
          <TextInput
            value={packageName}
            onChangeText={setPackageName}
            autoCapitalize="none"
            placeholder="com.example.app"
            placeholderTextColor="#94A3B8"
            style={styles.input}
          />
          <Text style={styles.inputLabel}>رقم الإصدار (اختياري)</Text>
          <TextInput
            value={appVersion}
            onChangeText={setAppVersion}
            autoCapitalize="none"
            placeholder="1.0.0"
            placeholderTextColor="#94A3B8"
            style={styles.input}
          />
          <View style={styles.compatibilityRow}>
            <Text style={styles.compatibilityLabel}>Samsung · Android 13–16+</Text>
            <Text style={styles.compatibilityValue}>جاهز</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>التقاط وتحليل</Text>
        <View style={styles.actionGrid}>
          <Pressable onPress={toggleCapture} style={({ pressed }) => [styles.actionButton, pressed && styles.pressed, isCapturing && styles.actionButtonActive]}>
            <Text style={styles.actionIcon}>{isCapturing ? "■" : "●"}</Text>
            <Text style={styles.actionTitle}>{isCapturing ? "إيقاف الجلسة" : "بدء جلسة"}</Text>
            <Text style={styles.actionHint}>Shizuku / ADB بموافقة المستخدم</Text>
          </Pressable>
          <Pressable onPress={importReport} style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
            <Text style={styles.actionIcon}>⇧</Text>
            <Text style={styles.actionTitle}>استيراد تقرير</Text>
            <Text style={styles.actionHint}>logcat · bugreport · txt</Text>
          </Pressable>
        </View>

        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>ملاحظة التشغيل</Text>
          <Text style={styles.noteText}>{status}</Text>
          <Text style={styles.noteSubtext}>{bridgeStatus}</Text>
          <Text style={styles.noteSubtext}>لا يقرأ CrashScope كلمات المرور أو محتوى التطبيقات؛ ويحلل فقط الملف الذي تختاره أو السجلات التي تمنحها صراحة.</Text>
        </View>

        {!report ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>⌘</Text>
            <Text style={styles.emptyTitle}>لا يوجد تقرير بعد</Text>
            <Text style={styles.emptyText}>ابدأ جلسة أو استورد تقريرًا. يمكنك أيضًا تجربة التحليل بعينة جاهزة.</Text>
            <Pressable onPress={loadDemo} style={({ pressed }) => [styles.demoButton, pressed && styles.pressed]}>
              <Text style={styles.demoButtonText}>تجربة تقرير Crash تجريبي</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.reportSection}>
            <View style={styles.reportHeader}>
              <View>
                <Text style={styles.sectionTitle}>نتيجة التحليل</Text>
                <Text style={styles.reportMeta}>{new Date(report.createdAt).toLocaleString("ar-TN")} · {report.source === "demo" ? "عينة" : "مستورد"}</Text>
              </View>
              <View style={styles.reportTypeBadge}><Text style={styles.reportTypeText}>{report.crashType}</Text></View>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryException}>{report.exception}</Text>
              <Text style={styles.summaryMessage}>{report.message}</Text>
              <Text style={styles.summaryLocation}>{report.location}</Text>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryStats}>
                <View><Text style={styles.statValue}>{report.findings.length}</Text><Text style={styles.statLabel}>نتائج</Text></View>
                <View><Text style={styles.statValue}>{report.packageName}</Text><Text style={styles.statLabel}>الحزمة</Text></View>
              </View>
            </View>
            <FlatList
              data={report.findings}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => <FindingCard finding={item} />}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            />
            <View style={styles.reportActions}>
              <Pressable onPress={saveReport} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><Text style={styles.secondaryButtonText}>حفظ محلي</Text></Pressable>
              <Pressable onPress={shareReport} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}><Text style={styles.primaryButtonText}>مشاركة التقرير</Text></Pressable>
            </View>
            <View style={styles.stackCard}>
              <Text style={styles.stackTitle}>Stack trace / Logcat</Text>
              <Text selectable style={styles.stackText}>{report.stackTrace}</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 44, gap: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  eyebrow: { color: "#5B6B88", fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  title: { color: "#0F172A", fontSize: 34, fontWeight: "900", letterSpacing: -1.2, marginTop: 3 },
  subtitle: { color: "#64748B", fontSize: 14, marginTop: 2 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F1F5F9", borderRadius: 20, paddingHorizontal: 11, paddingVertical: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusBadgeText: { color: "#475569", fontSize: 12, fontWeight: "700" },
  heroCard: { backgroundColor: "#13233F", borderRadius: 22, padding: 18, flexDirection: "row", alignItems: "center", marginTop: 4 },
  heroIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: "#24477C", alignItems: "center", justifyContent: "center", marginRight: 14 },
  heroIconText: { color: "#A7D8FF", fontSize: 31, fontWeight: "300" },
  heroCopy: { flex: 1 },
  heroTitle: { color: "#F8FAFC", fontSize: 17, fontWeight: "800", marginBottom: 5 },
  heroText: { color: "#C7D7EE", fontSize: 13, lineHeight: 20 },
  sectionTitle: { color: "#0F172A", fontSize: 19, fontWeight: "800", marginTop: 4 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "#E2E8F0" },
  inputLabel: { color: "#64748B", fontSize: 12, fontWeight: "700", marginBottom: 7, marginTop: 2 },
  input: { backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2E8F0", color: "#0F172A", borderRadius: 11, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, marginBottom: 11 },
  compatibilityRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 4 },
  compatibilityLabel: { color: "#475569", fontSize: 12, fontWeight: "700" },
  compatibilityValue: { color: "#15803D", fontSize: 12, fontWeight: "800" },
  actionGrid: { flexDirection: "row", gap: 10 },
  actionButton: { flex: 1, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D9E2EF", borderRadius: 17, padding: 15, minHeight: 130 },
  actionButtonActive: { borderColor: "#22C55E", backgroundColor: "#F0FDF4" },
  actionIcon: { color: "#1D4ED8", fontSize: 25, fontWeight: "900", marginBottom: 10 },
  actionTitle: { color: "#0F172A", fontSize: 15, fontWeight: "800" },
  actionHint: { color: "#64748B", fontSize: 11, lineHeight: 16, marginTop: 5 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  noteCard: { backgroundColor: "#FFF7ED", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#FED7AA" },
  noteTitle: { color: "#9A3412", fontSize: 13, fontWeight: "800", marginBottom: 4 },
  noteText: { color: "#7C2D12", fontSize: 13, fontWeight: "700" },
  noteSubtext: { color: "#9A3412", fontSize: 11, lineHeight: 16, marginTop: 5 },
  emptyState: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 19, alignItems: "center", paddingHorizontal: 22, paddingVertical: 30, marginTop: 2 },
  emptyIcon: { color: "#94A3B8", fontSize: 35, marginBottom: 8 },
  emptyTitle: { color: "#0F172A", fontSize: 18, fontWeight: "800" },
  emptyText: { color: "#64748B", fontSize: 13, textAlign: "center", lineHeight: 20, marginTop: 6, marginBottom: 16 },
  demoButton: { backgroundColor: "#E0ECFF", borderRadius: 12, paddingHorizontal: 15, paddingVertical: 11 },
  demoButtonText: { color: "#1D4ED8", fontSize: 13, fontWeight: "800" },
  reportSection: { gap: 10 },
  reportHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  reportMeta: { color: "#64748B", fontSize: 11, marginTop: 3 },
  reportTypeBadge: { backgroundColor: "#FEE2E2", borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  reportTypeText: { color: "#B91C1C", fontSize: 11, fontWeight: "800" },
  summaryCard: { backgroundColor: "#0F172A", borderRadius: 18, padding: 16 },
  summaryException: { color: "#FCA5A5", fontSize: 16, fontWeight: "800", lineHeight: 22 },
  summaryMessage: { color: "#E2E8F0", fontSize: 13, lineHeight: 20, marginTop: 7 },
  summaryLocation: { color: "#93C5FD", fontSize: 12, lineHeight: 18, marginTop: 9 },
  summaryDivider: { height: 1, backgroundColor: "#334155", marginVertical: 13 },
  summaryStats: { flexDirection: "row", gap: 28 },
  statValue: { color: "#F8FAFC", fontSize: 14, fontWeight: "800" },
  statLabel: { color: "#94A3B8", fontSize: 10, marginTop: 2 },
  findingCard: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#E2E8F0" },
  findingHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  severityDot: { width: 9, height: 9, borderRadius: 5 },
  findingTitle: { color: "#0F172A", fontSize: 14, fontWeight: "800", flex: 1 },
  severityText: { fontSize: 11, fontWeight: "800" },
  findingEvidence: { color: "#334155", fontSize: 12, marginTop: 9, fontFamily: "monospace" },
  findingAdvice: { color: "#475569", fontSize: 12, lineHeight: 18, marginTop: 8 },
  findingLocation: { color: "#2563EB", fontSize: 11, marginTop: 8 },
  reportActions: { flexDirection: "row", gap: 10, marginTop: 2 },
  secondaryButton: { flex: 1, alignItems: "center", borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 12, paddingVertical: 12 },
  secondaryButtonText: { color: "#334155", fontWeight: "800", fontSize: 13 },
  primaryButton: { flex: 1, alignItems: "center", backgroundColor: "#1D4ED8", borderRadius: 12, paddingVertical: 12 },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  stackCard: { backgroundColor: "#111827", borderRadius: 16, padding: 14, marginTop: 2 },
  stackTitle: { color: "#CBD5E1", fontSize: 12, fontWeight: "800", marginBottom: 9 },
  stackText: { color: "#D1FAE5", fontFamily: "monospace", fontSize: 11, lineHeight: 17 },
});
