import { Dashboard } from "@/components/Dashboard";
import { AssistantWidget } from "@/components/AssistantWidget";
import marketSnapshot from "@/data/market_snapshot.json";

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      <Dashboard initialSnapshot={marketSnapshot} />
      <AssistantWidget />
    </div>
  );
}
