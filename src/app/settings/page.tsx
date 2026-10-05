import Link from "next/link";
import ConnectorsSettings from "@/components/connectors/ConnectorsSettings";
import styles from "@/components/connectors/connectors.module.css";

export const metadata = { title: "Asetukset · SaarnaVideo" };

export default function SettingsPage() {
  return (
    <main className={styles.page}>
      <div>
        <Link href="/">← Projektit</Link>
      </div>
      <h1>Asetukset</h1>
      <ConnectorsSettings />
    </main>
  );
}
