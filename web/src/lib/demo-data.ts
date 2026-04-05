// Demo mode: returns realistic fake data for screenshots and demos

export const DEMO_STATS = {
  total_today: 847,
  spam_today: 123,
  ham_today: 724,
  quarantine_pending: 18,
  spam_rate: 14.5,
  total_week: 5832,
  hourly_stats: Array.from({ length: 24 }, (_, i) => ({
    hour: new Date(Date.now() - (23 - i) * 3600000).toISOString(),
    total: Math.floor(Math.random() * 60) + 20,
    spam: Math.floor(Math.random() * 12) + 2,
    ham: Math.floor(Math.random() * 50) + 15,
  })),
};

const DEMO_DOMAINS = [
  "example.com", "acme-corp.de", "techstart.io", "mueller-gmbh.de",
  "globalmail.net", "innovate.eu", "cloudhost.com", "webshop24.de",
];

const DEMO_NAMES = [
  "info", "admin", "support", "contact", "office", "sales",
  "newsletter", "noreply", "service", "team", "hello", "mail",
];

const DEMO_SUBJECTS_HAM = [
  "Meeting tomorrow at 10 AM",
  "Invoice #2024-1847 attached",
  "Re: Project update Q2",
  "Your order has been shipped",
  "Weekly team standup notes",
  "Contract renewal reminder",
  "New employee onboarding",
  "Quarterly report ready for review",
  "Server maintenance window Saturday",
  "Holiday schedule update",
];

const DEMO_SUBJECTS_SPAM = [
  "URGENT: Your account has been compromised!",
  "You have WON $1,000,000!!!",
  "Get rich quick - guaranteed returns!",
  "Cheap medications - 90% off!!!",
  "Your package is waiting - verify now",
  "FINAL WARNING: Payment overdue",
  "Hot singles in your area",
  "Congratulations! You've been selected",
  "Enlarge your portfolio today",
  "Re: Wire transfer confirmation needed",
];

const DEMO_SYMBOLS = [
  { name: "BAYES_SPAM", score: 5.1, description: "Bayes classifier: spam" },
  { name: "RDNS_NONE", score: 2.0, description: "No reverse DNS" },
  { name: "HFILTER_HOSTNAME_UNKNOWN", score: 2.5, description: "Unknown hostname" },
  { name: "SUBJ_ALL_CAPS", score: 2.1, description: "Subject all caps" },
  { name: "MISSING_TO", score: 2.0, description: "Missing To header" },
  { name: "R_SPF_ALLOW", score: -0.2, description: "SPF allows" },
  { name: "R_DKIM_ALLOW", score: -0.2, description: "DKIM verified" },
  { name: "MIME_GOOD", score: -0.1, description: "Good MIME structure" },
  { name: "DMARC_POLICY_ALLOW", score: -0.5, description: "DMARC pass" },
  { name: "FORGED_SENDER", score: 0.3, description: "Forged sender" },
];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomEmail(): string {
  return `${randomFrom(DEMO_NAMES)}@${randomFrom(DEMO_DOMAINS)}`;
}

function randomIp(): string {
  return `${Math.floor(Math.random() * 200) + 10}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

function randomDate(hoursAgo: number = 48): string {
  const d = new Date(Date.now() - Math.random() * hoursAgo * 3600000);
  return d.toISOString();
}

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function generateDemoLogs(count: number = 50) {
  return {
    items: Array.from({ length: count }, () => {
      const isSpam = Math.random() < 0.2;
      const action = isSpam
        ? Math.random() < 0.6 ? "quarantined" : "rejected"
        : "delivered";
      const rspamdScore = isSpam
        ? +(Math.random() * 10 + 3).toFixed(1)
        : +(Math.random() * 3).toFixed(1);
      const symbols: Record<string, { score: number }> = {};
      const numSymbols = Math.floor(Math.random() * 5) + 3;
      for (let i = 0; i < numSymbols; i++) {
        const sym = DEMO_SYMBOLS[Math.floor(Math.random() * DEMO_SYMBOLS.length)];
        symbols[sym.name] = { score: sym.score };
      }
      return {
        id: uuid(),
        message_id: `<${uuid().slice(0, 8)}@${randomFrom(DEMO_DOMAINS)}>`,
        mail_from: randomEmail(),
        rcpt_to: [randomEmail()],
        subject: isSpam ? randomFrom(DEMO_SUBJECTS_SPAM) : randomFrom(DEMO_SUBJECTS_HAM),
        direction: Math.random() < 0.85 ? "inbound" : "outbound",
        action,
        rspamd_score: rspamdScore,
        ai_score: Math.random() < 0.15 ? +(Math.random() * 8).toFixed(1) : null,
        final_score: rspamdScore,
        rspamd_symbols: symbols,
        client_ip: randomIp(),
        created_at: randomDate(),
      };
    }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    total: count,
    page: 1,
    page_size: count,
  };
}

export function generateDemoQuarantine(count: number = 18) {
  return {
    items: Array.from({ length: count }, () => ({
      id: uuid(),
      mail_from: randomEmail(),
      rcpt_to: [randomEmail()],
      subject: randomFrom(DEMO_SUBJECTS_SPAM),
      rspamd_score: +(Math.random() * 8 + 4).toFixed(1),
      final_score: +(Math.random() * 8 + 4).toFixed(1),
      status: "pending",
      body_preview: "This is a suspicious email that has been quarantined for review...",
      parsed_headers: null,
      created_at: randomDate(72),
    })),
    total: count,
    page: 1,
    page_size: 20,
  };
}

export function generateDemoDomains() {
  return [
    { id: uuid(), domain: "example.com", backend_host: "mail1.example.com", backend_port: 25, is_active: true, description: "Main domain", created_at: randomDate(720) },
    { id: uuid(), domain: "acme-corp.de", backend_host: "mx.acme-corp.de", backend_port: 25, is_active: true, description: "Corporate mail", created_at: randomDate(720) },
    { id: uuid(), domain: "techstart.io", backend_host: "mail.techstart.io", backend_port: 587, is_active: true, description: null, created_at: randomDate(360) },
    { id: uuid(), domain: "old-domain.net", backend_host: "legacy.old-domain.net", backend_port: 25, is_active: false, description: "Deprecated", created_at: randomDate(1440) },
  ];
}

export const DEMO_POSTFIX_LOG = {
  lines: [
    "Apr 05 10:23:15 mail postfix/smtpd[1234]: connect from mail-out.example.com[93.184.216.34]",
    "Apr 05 10:23:15 mail postfix/smtpd[1234]: Anonymous TLS connection established from mail-out.example.com[93.184.216.34]",
    "Apr 05 10:23:16 mail postfix/smtpd[1234]: ABC123DEF: client=mail-out.example.com[93.184.216.34]",
    "Apr 05 10:23:16 mail postfix/cleanup[1235]: ABC123DEF: message-id=<demo@example.com>",
    "Apr 05 10:23:16 mail postfix/qmgr[108]: ABC123DEF: from=<info@example.com>, size=4521, nrcpt=1 (queue active)",
    "Apr 05 10:23:17 mail postfix/smtp[1236]: ABC123DEF: to=<user@acme-corp.de>, relay=mx.acme-corp.de[10.0.1.5]:25, delay=1.2, dsn=2.0.0, status=sent (250 OK)",
    "Apr 05 10:23:17 mail postfix/qmgr[108]: ABC123DEF: removed",
    "Apr 05 10:23:45 mail postfix/smtpd[1234]: connect from unknown[185.42.12.99]",
    "Apr 05 10:23:46 mail postfix/smtpd[1234]: DEF456GHI: client=unknown[185.42.12.99]",
    "Apr 05 10:23:47 mail postfix/cleanup[1235]: DEF456GHI: milter-reject: END-OF-MESSAGE from unknown[185.42.12.99]: 4.7.1 Try again later",
    "Apr 05 10:24:01 mail postfix/smtpd[1234]: connect from mx.techstart.io[203.0.113.50]",
    "Apr 05 10:24:02 mail postfix/smtpd[1234]: GHI789JKL: client=mx.techstart.io[203.0.113.50]",
    "Apr 05 10:24:02 mail postfix/qmgr[108]: GHI789JKL: from=<noreply@techstart.io>, size=12840, nrcpt=1 (queue active)",
    "Apr 05 10:24:03 mail postfix/smtp[1237]: GHI789JKL: to=<contact@example.com>, relay=mail1.example.com:25, delay=0.8, dsn=2.0.0, status=sent (250 OK)",
    "Apr 05 10:24:03 mail postfix/qmgr[108]: GHI789JKL: removed",
  ],
  total: 15,
};
