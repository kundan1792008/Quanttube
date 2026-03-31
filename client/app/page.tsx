import { MediaProvider } from "./context/MediaContext";
import QuantMediaContainer from "./components/QuantMediaContainer";

export default function Home() {
  return (
    <MediaProvider>
      <QuantMediaContainer />
    </MediaProvider>
  );
}
