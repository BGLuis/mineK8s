use std::net::IpAddr;
use std::num::NonZeroU32;
use std::sync::Arc;

use governor::clock::DefaultClock;
use governor::state::keyed::DefaultKeyedStateStore;
use governor::{Quota, RateLimiter};

pub type KeyedRateLimiter = RateLimiter<IpAddr, DefaultKeyedStateStore<IpAddr>, DefaultClock>;

#[derive(Clone)]
pub struct ConnectionRateLimiter {
    inner: Arc<KeyedRateLimiter>,
}

impl ConnectionRateLimiter {
    /// Cria um novo rate limiter com uma cota fixa de requisições por segundo por IP (RF-GW-14).
    pub fn new(requests_per_second: u32) -> Self {
        let quota = Quota::per_second(
            NonZeroU32::new(requests_per_second).expect("requests_per_second deve ser > 0"),
        );
        Self {
            inner: Arc::new(RateLimiter::keyed(quota)),
        }
    }

    /// Verifica se o IP tem permissão para conectar. Retorna `Ok(())` se dentro da quota, ou `Err(())` se excedido.
    pub fn check(&self, ip: IpAddr) -> bool {
        self.inner.check_key(&ip).is_ok()
    }
}

impl Default for ConnectionRateLimiter {
    fn default() -> Self {
        // Padrão RF-GW-14: ~10 conexões/s por IP
        Self::new(10)
    }
}
