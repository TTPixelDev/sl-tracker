import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppV1 from './views/AppV1';
import AppV2 from './views/AppV2';

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/v1" element={<AppV1 />} />
                <Route path="/v2" element={<AppV2 />} />
                <Route path="/" element={<AppV2 />} />
                <Route path="*" element={<Navigate to="/v2" replace />} />
            </Routes>
        </BrowserRouter>
    );
}
