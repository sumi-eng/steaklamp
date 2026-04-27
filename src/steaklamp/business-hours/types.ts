export type StoreRow = {
  id: string;
  code: string;
  name: string;
  timezone: string;
  is_active: boolean;
};

export type BusinessHourRow = {
  id: string;
  store_id: string;
  weekday: number;
  is_closed: boolean;
  open_on_day_before_holiday: boolean;
  open_time: string | null;
  close_time: string | null;
  reservation_start_time: string | null;
  reservation_end_time: string | null;
  reservation_interval_minutes: number;
  default_stay_minutes: number;
};

export type BusinessHoursResponse = {
  ok: boolean;
  store?: StoreRow;
  rows?: BusinessHourRow[];
  error?: string;
};
