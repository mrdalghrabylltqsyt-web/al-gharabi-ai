import React from 'react';
import { useApp } from '../../context/AppContext';
import {
  Calendar as CalendarIcon,
  Plus,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import {
  ARABIC_WEEKDAYS,
  arabicMonthLabel,
  epochToZonedWallClock,
  parseWallClock,
  toScheduleDisplay,
  APP_TIMEZONE,
} from '../../utils/scheduleTime';
import { ScheduledJobsPanel } from './ScheduledJobsPanel';

/** الجدار الزمني البغدادي ليوم المنشور: `scheduledFor` للمجدول، وإلا `publishedAt`/`createdAt`. */
function postWallClock(post: any) {
  const source = post?.scheduledFor || post?.publishedAt || post?.createdAt;
  const wall = parseWallClock(source);
  if (wall) return wall;
  const epoch = Date.parse(source);
  return Number.isFinite(epoch) ? epochToZonedWallClock(epoch) : null;
}

/** وقت العرض المحلي للمنشور (بغداد) — لا يُخترع وقت افتراضي. */
function postTimeLabel(post: any): string {
  const shown = toScheduleDisplay(post?.scheduledFor || post?.publishedAt || post?.createdAt);
  return shown ? shown.slice(11, 16) : '—';
}

export const ContentCalendarView: React.FC = () => {
  const { posts, setActiveTab } = useApp();

  // التاريخ الفعلي بتوقيت بغداد (لا قيمة ثابتة): نحدّد الأسبوع الجاري ويومه.
  const now = Date.now();
  const today = epochToZonedWallClock(now, APP_TIMEZONE);
  const currentMonth = arabicMonthLabel(now, APP_TIMEZONE);

  // أسبوع بغداد الجاري: الأحد → السبت حول «اليوم» (بدل أيام ثابتة 14..20).
  const todayEpoch = Date.UTC(today.year, today.month - 1, today.day);
  const todayDow = new Date(todayEpoch).getUTCDay(); // 0 = الأحد
  const calendarDays = Array.from({ length: 7 }, (_, i) => {
    const dayEpoch = todayEpoch + (i - todayDow) * 86400000;
    const wall = epochToZonedWallClock(dayEpoch);
    return {
      day: wall.day,
      isToday: i === todayDow,
      // المنشورات موزّعة على يومها الحقيقي فقط (لا كلها في يوم واحد).
      events: posts.filter((p) => {
        const w = postWallClock(p);
        return w && w.year === wall.year && w.month === wall.month && w.day === wall.day;
      }),
    };
  });
  const daysOfWeek = [...ARABIC_WEEKDAYS];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="p-6 rounded-2xl glass flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-cyan-400" />
            تقويم وخطة نشر المحتوى المجدول
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            جدولة مواعيد النشر عبر جميع المنصات ومطابقتها مع أوقات الذروة والتفاعل المعتمدة.
          </p>
        </div>

        <button
          onClick={() => setActiveTab('content')}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-md shadow-emerald-500/20 transition cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          جدولة منشور جديد
        </button>
      </div>

      {/* Week Navigator */}
      <div className="flex items-center justify-between p-4 rounded-2xl glass">
        <div className="flex items-center gap-2">
          <button className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white cursor-pointer">
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="text-sm font-bold text-white px-2">{currentMonth} - الأسبوع الجاري</span>
          <button className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white cursor-pointer">
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span> مجدول ومعتمد
          </span>
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span> قيد المراجعة
          </span>
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span> تم النشر
          </span>
        </div>
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {calendarDays.map((d, idx) => (
          <div
            key={idx}
            className={`min-h-[220px] rounded-2xl p-3 border flex flex-col justify-between transition ${
              d.isToday
                ? 'bg-slate-900/90 border-emerald-500/50 shadow-lg shadow-emerald-950/30'
                : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2">
                <span className="text-xs font-bold text-slate-300">{daysOfWeek[idx]}</span>
                <span
                  className={`text-xs font-extrabold w-6 h-6 rounded-full flex items-center justify-center ${
                    d.isToday ? 'bg-emerald-500 text-slate-950' : 'text-slate-400'
                  }`}
                >
                  {d.day}
                </span>
              </div>

              {/* Day Events */}
              <div className="space-y-1.5">
                {d.events.map((ev: any, evIdx: number) => {
                  const isPublished = ev.status === 'published';
                  const isScheduled = ev.status === 'scheduled';
                  const isReview = ev.status === 'review';

                  return (
                    <div
                      key={evIdx}
                      className={`p-2 rounded-xl text-right text-[11px] border space-y-1 cursor-pointer transition ${
                        isPublished
                          ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-200'
                          : isScheduled
                          ? 'bg-cyan-950/40 border-cyan-500/30 text-cyan-200'
                          : 'bg-amber-950/40 border-amber-500/30 text-amber-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold truncate max-w-[90px]">{ev.title}</span>
                        <span className="text-[9px] font-mono opacity-80">{postTimeLabel(ev)}</span>
                      </div>
                      <div className="flex items-center justify-between text-[9px] text-slate-400">
                        <span className="uppercase">{ev.platform || 'سوشيال'}</span>
                        <span className="text-slate-300 font-medium">
                          {isPublished ? 'منشور' : isScheduled ? 'مجدول' : 'مراجعة'}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {d.events.length === 0 && (
                  <div className="py-8 text-center text-slate-600 text-[11px]">
                    لا توجد منشورات
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={() => setActiveTab('content')}
              className="w-full py-1.5 mt-2 rounded-lg bg-slate-950/60 hover:bg-slate-800 text-[10px] text-slate-400 hover:text-white transition flex items-center justify-center gap-1 cursor-pointer border border-dashed border-slate-800"
            >
              <Plus className="w-3 h-3" />
              إضافة
            </button>
          </div>
        ))}
      </div>
      <ScheduledJobsPanel />
    </div>
  );
};
