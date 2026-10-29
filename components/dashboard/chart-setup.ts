import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

// The design's Chart.js defaults (RingzPOS Dashboard.dc.html).
ChartJS.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
ChartJS.defaults.font.size = 12;
ChartJS.defaults.color = "#6d777a";
