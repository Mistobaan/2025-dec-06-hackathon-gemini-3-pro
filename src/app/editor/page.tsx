import dynamic from "next/dynamic";

const EditorCanvas = dynamic(() => import("@/components/editor/EditorCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[60vh] items-center justify-center text-sm text-zinc-500">
      Loading editor...
    </div>
  ),
});

export default function EditorPage() {
  return (
    <div className="mx-auto max-w-6xl py-8">
      <EditorCanvas />
    </div>
  );
}
