export type SeatRow = {
  id: string;
  store_id: string;
  name: string;
  zone: string;
  seat_type: "table" | "group";
  capacity_min: number;
  capacity_max: number;
  is_active: boolean;
  is_reservable: boolean;
  sort_order: number;
};

export type SeatsResponse = {
  ok: boolean;
  rows?: SeatRow[];
  error?: string;
};
