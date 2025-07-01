import axios from "axios";

// 設定 API 基礎 URL
const API_BASE_URL =
  process.env.REACT_APP_API_URL || "http://localhost:8000/api/v1";

// 創建 axios 實例
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
});

// 請求攔截器
apiClient.interceptors.request.use(
  (config) => {
    // 從 localStorage 或 AsyncStorage 獲取 token
    const token =
      typeof window !== "undefined" ? localStorage.getItem("authToken") : null;

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 回應攔截器
apiClient.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    // 處理常見錯誤
    if (error.response?.status === 401) {
      // Token 過期或無效，清除本地儲存的 token
      if (typeof window !== "undefined") {
        localStorage.removeItem("authToken");
        localStorage.removeItem("user");
      }
      // 重定向到登入頁面（需要根據實際路由配置調整）
      window.location.href = "/auth";
    }

    return Promise.reject(error);
  }
);

// API 端點
export const authAPI = {
  login: (credentials) => apiClient.post("/auth/login", credentials),
  register: (userData) => apiClient.post("/auth/register", userData),
  logout: () => apiClient.post("/auth/logout"),
  refreshToken: () => apiClient.post("/auth/refresh"),
  getProfile: () => apiClient.get("/auth/profile"),
  updateProfile: (data) => apiClient.put("/auth/profile", data),
  deleteAccount: () => apiClient.delete("/auth/account"),
};

export const tourAPI = {
  getTours: (params) => apiClient.get("/tours", { params }),
  getTour: (id) => apiClient.get(`/tours/${id}`),
  createTour: (data) => apiClient.post("/tours", data),
  updateTour: (id, data) => apiClient.put(`/tours/${id}`, data),
  deleteTour: (id) => apiClient.delete(`/tours/${id}`),
  generateTour: (params) => apiClient.post("/tours/generate", params),
  searchTours: (query) =>
    apiClient.get("/tours/search", { params: { q: query } }),
};

export const merchantAPI = {
  register: (data) => apiClient.post("/merchants/register", data),
  getProfile: () => apiClient.get("/merchants/profile"),
  updateProfile: (data) => apiClient.put("/merchants/profile", data),
  getContent: () => apiClient.get("/merchants/content"),
  uploadContent: (data) => apiClient.post("/merchants/content", data),
  updateContent: (id, data) => apiClient.put(`/merchants/content/${id}`, data),
  deleteContent: (id) => apiClient.delete(`/merchants/content/${id}`),
  getProducts: () => apiClient.get("/merchants/products"),
  createProduct: (data) => apiClient.post("/merchants/products", data),
  updateProduct: (id, data) => apiClient.put(`/merchants/products/${id}`, data),
  deleteProduct: (id) => apiClient.delete(`/merchants/products/${id}`),
};

export const fileAPI = {
  upload: (file, type = "image") => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", type);

    return apiClient.post("/files/upload", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
  },
  delete: (fileId) => apiClient.delete(`/files/${fileId}`),
};

export default apiClient;
