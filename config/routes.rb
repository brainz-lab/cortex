Rails.application.routes.draw do
  # Health check
  get "up" => "rails/health#show", as: :rails_health_check

  # WebSocket
  mount ActionCable.server => "/cable"

  # Root path
  root "home#index"
end
