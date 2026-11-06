import { withWidgetErrors } from "@/lib/widget/guard";
import { serveGreetingImage } from "@/lib/widget/image-response";

export const GET = withWidgetErrors(async (req) => serveGreetingImage(new URL(req.url).searchParams.get("key")));
