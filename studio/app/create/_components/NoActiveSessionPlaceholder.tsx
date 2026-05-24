export function NoActiveSessionPlaceholder() {
  return (
    <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-4">
      <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center rotate-3 border-2 border-dashed border-muted-foreground/30">
        <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">No Active Session</p>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          PDF를 업로드해 새 작업을 시작하거나<br />우측 상단에서 이전 작업을 재개하세요.
        </p>
      </div>
    </div>
  );
}
