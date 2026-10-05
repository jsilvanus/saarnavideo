import Link from "next/link";
import ConnectorsSettings from "@/components/connectors/ConnectorsSettings";
import YouTubeCookiesSettings from "@/components/connectors/YouTubeCookiesSettings";
import styles from "@/components/connectors/connectors.module.css";
import { getServerLocale } from "@/i18n/server";
import { makeT } from "@/i18n/translate";

export async function generateMetadata() {
  return { title: `${makeT(await getServerLocale())("settings.title")} · SaarnaVideo` };
}

export default async function SettingsPage() {
  const t = makeT(await getServerLocale());
  return (
    <main className={styles.page}>
      <div>
        <Link href="/">{t("settings.back")}</Link>
      </div>
      <h1>{t("settings.title")}</h1>
      <YouTubeCookiesSettings />
      <ConnectorsSettings />
    </main>
  );
}
