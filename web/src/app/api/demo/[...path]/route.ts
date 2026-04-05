import { NextRequest, NextResponse } from "next/server";
import {
  DEMO_STATS,
  generateDemoLogs,
  generateDemoQuarantine,
  generateDemoDomains,
  DEMO_POSTFIX_LOG,
} from "@/lib/demo-data";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const endpoint = path.join("/");

  switch (endpoint) {
    case "stats":
      return NextResponse.json(DEMO_STATS);
    case "logs":
      return NextResponse.json(generateDemoLogs());
    case "quarantine":
      return NextResponse.json(generateDemoQuarantine());
    case "domains":
      return NextResponse.json(generateDemoDomains());
    case "postfix-log":
      return NextResponse.json(DEMO_POSTFIX_LOG);
    case "settings":
      return NextResponse.json([
        { key: "spam_quarantine_threshold", value: 5.0, category: "scanning", description: "Score above which mail is quarantined" },
        { key: "spam_reject_threshold", value: 10.0, category: "scanning", description: "Score above which mail is rejected" },
        { key: "antivirus_enabled", value: true, category: "scanning", description: "Enable ClamAV virus scanning" },
        { key: "rbl_enabled", value: true, category: "scanning", description: "Enable DNS blocklist checks" },
        { key: "spf_enabled", value: true, category: "scanning", description: "Enable SPF verification" },
        { key: "ai_enabled", value: true, category: "ai", description: "Enable AI spam classification" },
        { key: "dkim_signing_enabled", value: true, category: "smtp", description: "Enable DKIM signing" },
        { key: "block_google_groups", value: true, category: "scanning", description: "Block Google Groups spam" },
        { key: "block_bulk_unsolicited", value: true, category: "scanning", description: "Block unsolicited bulk mail" },
      ]);
    case "queue":
      return NextResponse.json({ items: [], total: 0 });
    case "delivery-status":
      return NextResponse.json({ items: [], total: 0, page: 1, page_size: 50 });
    case "sender-domains":
      return NextResponse.json([
        { id: "1", domain: "example.com", is_verified: true, is_active: true, verification_method: "dns", spf_status: "ok", spf_includes_proxy: true, dkim_status: "ok", dkim_selector: "spamproxy", mx_status: "ok", mx_records: ["10 mail.example.com."], created_at: "2026-01-15" },
        { id: "2", domain: "acme-corp.de", is_verified: true, is_active: true, verification_method: "manual", spf_status: "ok", spf_includes_proxy: true, dkim_status: "missing", mx_status: "ok", mx_records: ["10 mx.acme-corp.de."], created_at: "2026-02-20" },
      ]);
    case "smtp-credentials":
      return NextResponse.json([
        { id: "1", username: "relay@example.com", display_name: "Relay User", allowed_from: ["info@example.com"], is_active: true, max_messages_per_hour: 100, created_at: "2026-01-15" },
      ]);
    case "rbl":
      return NextResponse.json([
        { id: "1", name: "Spamhaus ZEN", rbl_host: "zen.spamhaus.org", list_type: "ip", description: "Combined IP blocklist", is_active: true },
        { id: "2", name: "Spamhaus DBL", rbl_host: "dbl.spamhaus.org", list_type: "domain", description: "Domain Block List", is_active: true },
        { id: "3", name: "Barracuda", rbl_host: "b.barracudacentral.org", list_type: "ip", description: "Barracuda RBL", is_active: true },
        { id: "4", name: "SpamCop", rbl_host: "bl.spamcop.net", list_type: "ip", description: "SpamCop BL", is_active: false },
      ]);
    case "keyword-rules":
      return NextResponse.json([
        { id: "1", keyword: "viagra", match_type: "contains", match_field: "any", score_adjustment: 5.0, description: "Typical spam keyword", is_active: true },
        { id: "2", keyword: "casino", match_type: "contains", match_field: "any", score_adjustment: 4.0, description: "Gambling spam", is_active: true },
        { id: "3", keyword: "lottery", match_type: "contains", match_field: "any", score_adjustment: 5.0, description: "Lottery scam", is_active: true },
        { id: "4", keyword: "unsubscribe", match_type: "contains", match_field: "body", score_adjustment: -0.5, description: "Has unsubscribe link", is_active: true },
      ]);
    case "scoring-rules":
      return NextResponse.json([
        { id: "1", rule_type: "tld", pattern: ".ru", score_adjustment: 3.0, description: "Russian TLD", is_active: true },
        { id: "2", rule_type: "tld", pattern: ".de", score_adjustment: -1.0, description: "German TLD - trusted", is_active: true },
        { id: "3", rule_type: "tld", pattern: ".xyz", score_adjustment: 3.5, description: "Spam TLD", is_active: true },
        { id: "4", rule_type: "tld", pattern: ".com", score_adjustment: -0.5, description: "Standard TLD", is_active: true },
      ]);
    case "access-lists":
      return NextResponse.json([
        { id: "1", list_type: "whitelist", entry_type: "domain", value: "trusted-partner.com", description: "Business partner", is_active: true },
        { id: "2", list_type: "blacklist", entry_type: "domain", value: "spammer.xyz", description: "Known spammer", is_active: true },
        { id: "3", list_type: "blacklist", entry_type: "ip", value: "192.168.99.99", description: "Blocked IP", is_active: true },
      ]);
    case "dkim":
      return NextResponse.json([
        { id: "1", domain: "example.com", selector: "spamproxy", public_key: "MIIBIjANBg...", dns_record: "v=DKIM1; k=rsa; p=MIIBIjANBg...", key_type: "rsa", key_bits: 2048, is_active: true, created_at: "2026-01-15" },
      ]);
    case "federation/peers":
      return NextResponse.json([
        { id: "1", name: "Backup Server", url: "http://backup.example.com:11333", has_password: true, sync_bayes_learn: true, sync_fuzzy: true, direction: "both", is_active: true, last_sync: "2026-04-05T08:00:00Z", last_error: null, total_synced: 1247, created_at: "2026-02-01" },
      ]);
    case "bayes-training/status":
      return NextResponse.json({
        last_spam_trained: "2026-03",
        ham_corpus_trained: true,
        spam_source: "https://untroubled.org/spam/",
        ham_source: "SpamAssassin easy_ham corpus",
        months_total: 27,
        months_trained: 15,
        months_remaining: 12,
        trained_months: ["2024-01","2024-02","2024-03","2024-04","2024-05","2024-06","2024-07","2024-08","2024-09","2024-10","2024-11","2024-12","2025-01","2025-02","2025-03"],
        rspamd_learned: 18420,
        rspamd_ham_count: 6200,
        rspamd_spam_count: 12220,
      });
    default:
      return NextResponse.json({ status: "ok", demo: true });
  }
}

export async function POST() {
  return NextResponse.json({ status: "ok", demo: true });
}

export async function PUT() {
  return NextResponse.json({ status: "ok", demo: true });
}

export async function DELETE() {
  return NextResponse.json({ status: "ok", demo: true });
}
